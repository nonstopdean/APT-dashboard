import { fetchRegionMonth, lastNMonths } from '../../../lib/molit';
import { kvReady, kvGet, kvSet } from '../../../lib/kv';
import { regionLabel } from '../../../lib/regions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function avgPricePerPyeong(items) {
  const valid = items
    .map((r) => {
      const area = parseFloat(r.excluUseAr);
      const amount = parseInt(String(r.dealAmount ?? '').replace(/,/g, ''), 10);
      if (!area || !Number.isFinite(amount)) return null;
      return amount / (area / 3.3058);
    })
    .filter((v) => v);
  return valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
}

async function postToDiscord(webhookUrl, content) {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

export async function GET(request) {
  // Vercel Cron 요청인지 간단히 확인 (CRON_SECRET을 설정한 경우에만 검사)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return Response.json({ error: '인증 실패' }, { status: 401 });
    }
  }

  const serviceKey = (process.env.MOLIT_SERVICE_KEY || '').trim();
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  const watchCodes = (process.env.ALERT_REGIONS || '').split(',').map((c) => c.trim()).filter(Boolean);
  const thresholdPct = parseFloat(process.env.ALERT_THRESHOLD_PCT || '1');

  if (!serviceKey) return Response.json({ error: 'MOLIT_SERVICE_KEY 없음' }, { status: 500 });
  if (!webhookUrl) return Response.json({ error: 'DISCORD_WEBHOOK_URL 없음' }, { status: 500 });
  if (!kvReady()) return Response.json({ error: 'KV(Vercel Storage) 연결 안 됨' }, { status: 500 });
  if (watchCodes.length === 0) return Response.json({ error: 'ALERT_REGIONS 미설정' }, { status: 400 });

  const [thisMonth] = lastNMonths(1);
  const results = [];

  for (const code of watchCodes) {
    try {
      const items = await fetchRegionMonth(serviceKey, code, thisMonth);
      const current = avgPricePerPyeong(items);
      if (current == null) {
        results.push({ code, skipped: '이번 달 거래 없음' });
        continue;
      }

      const key = `apt-alert:${code}`;
      const prev = await kvGet(key);
      await kvSet(key, { value: current, ym: thisMonth, checkedAt: new Date().toISOString() });

      if (prev && prev.value) {
        const changePct = ((current - prev.value) / prev.value) * 100;
        results.push({ code, prev: prev.value, current, changePct });
        if (Math.abs(changePct) >= thresholdPct) {
          const dir = changePct > 0 ? '📈 상승' : '📉 하락';
          const msg = `${dir} **${regionLabel(code)}** 평당가 변동 감지\n`
            + `이전: ${Math.round(prev.value).toLocaleString()}만원 → 현재: ${Math.round(current).toLocaleString()}만원 `
            + `(${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%)`;
          await postToDiscord(webhookUrl, msg);
          results[results.length - 1].notified = true;
        }
      } else {
        results.push({ code, current, note: '최초 기록 (다음부터 비교 시작)' });
      }
    } catch (e) {
      results.push({ code, error: e.message });
    }
  }

  const userAlertResults = kvReady() ? await checkUserAlerts(serviceKey, webhookUrl) : [];

  return Response.json({ checkedAt: new Date().toISOString(), results, userAlertResults });
}

// 사용자가 등록한 단지별 가격 알림도 같은 크론에서 같이 확인한다.
export async function checkUserAlerts(serviceKey, webhookUrl) {
  const list = (await kvGet('user-alerts-list')) || [];
  const pending = list.filter((a) => !a.firedAt);
  if (pending.length === 0) return [];

  const [thisMonth, lastMonth] = lastNMonths(2);
  const results = [];

  for (const alert of pending) {
    try {
      const [rowsThis, rowsLast] = await Promise.all([
        fetchRegionMonth(serviceKey, alert.regionCode, thisMonth),
        fetchRegionMonth(serviceKey, alert.regionCode, lastMonth),
      ]);
      const rows = [...rowsThis, ...rowsLast].filter((r) => r.aptNm === alert.apt && r.umdNm === alert.dong);
      if (rows.length === 0) {
        results.push({ id: alert.id, skipped: '최근 거래 없음' });
        continue;
      }
      const latest = rows.sort((a, b) => `${b.dealYear}${b.dealMonth}${b.dealDay}`.localeCompare(`${a.dealYear}${a.dealMonth}${a.dealDay}`))[0];
      const price = parseInt(String(latest.dealAmount ?? '').replace(/,/g, ''), 10);
      const triggered = alert.direction === 'above' ? price >= alert.targetPrice : price <= alert.targetPrice;
      results.push({ id: alert.id, price, triggered });
      if (triggered && webhookUrl) {
        const dir = alert.direction === 'above' ? '이상' : '이하';
        const msg = `🔔 **${alert.apt}** (${alert.regionName} ${alert.dong}) 알림\n`
          + `목표가 ${alert.targetPrice.toLocaleString()}만원 ${dir} 도달 — 최근 거래가 ${price.toLocaleString()}만원`;
        await postToDiscord(webhookUrl, msg);
        alert.firedAt = new Date().toISOString();
      }
    } catch (e) {
      results.push({ id: alert.id, error: e.message });
    }
  }

  await kvSet('user-alerts-list', list);
  return results;
}

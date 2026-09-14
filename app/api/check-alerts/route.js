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

  return Response.json({ checkedAt: new Date().toISOString(), results });
}

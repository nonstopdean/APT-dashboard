import { fetchRegionMonth, runPool } from '../../../lib/molit';
import { REGION_GROUPS } from '../../../lib/regions';
import {
  kvReady, kvGet, kvMGet, kvMSet,
} from '../../../lib/kv';
import {
  leafRegions, countsOf, diffNew, updateMax, buildDailyReport, kstDate, monthsToFetch, monthsBefore, backfillTask, appendStat,
} from '../../../lib/daily-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// v250: 매일 아침(vercel.json 크론, 한국 시간 8시) 수도권 아파트 매매를 받아 전날 저장본과 비교해 "새로 공개된 거래"를 저장한다.
// 저장 키: daily:seen:<지역> = { months, counts }(거래 지문 개수), daily:max:<지역> = 단지·면적별 최고가,
//          daily:report:<YYYYMMDD> = 그날 리포트, daily:index = 리포트 날짜 목록(최근 90개).
// 하루 한 번만 돈다(같은 날 다시 부르면 건너뜀). CRON_SECRET을 설정하면 그 값이 있는 요청(Vercel 크론)만 받는다.
// v251: 남는 시간에 과거 3년 치를 조금씩 받아 최고가 기록(daily:max)을 채운다(daily:backfill = 진행 위치).
//       처음 몇 주 신고가가 부풀려지던 것을 줄이려고. 시간이 모자라면 다음 날 이어서.
const SEEN = 'daily:seen:';
const MAX = 'daily:max:';
const INDEX = 'daily:index';
const BACKFILL = 'daily:backfill';
const STATS = 'daily:stats'; // v257: [{ d, t, h, s: {서울,인천,경기}, f }] 최신이 앞
const BACK_MONTHS = 34; // 오늘 받는 2개월 + 34개월 = 약 3년
const DEADLINE_MS = 35000; // 60초 한도 안에서 저장(최대 수 MB)할 시간을 넉넉히 남긴다

const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

export async function GET(request) {
  const secret = (process.env.CRON_SECRET || '').trim();
  const authed = Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
  if (secret && !authed) return Response.json({ error: '인증 실패' }, { status: 401 });
  if (!kvReady()) return Response.json({ error: '저장소(KV)가 연결되지 않았어요.' }, { status: 500 });
  const serviceKey = (process.env.MOLIT_SERVICE_KEY || '').trim();
  if (!serviceKey) return Response.json({ error: '서버 설정이 필요해요.' }, { status: 500 });

  const started = Date.now();
  const date = kstDate();
  const force = new URL(request.url).searchParams.get('force') === '1' && authed;
  const index = (await kvGet(INDEX)) || [];
  if (index.includes(date) && !force) return Response.json({ skipped: '오늘은 이미 저장했어요', date });

  const regions = leafRegions(REGION_GROUPS);
  const months = monthsToFetch();
  const tasks = [];
  regions.forEach((r) => months.forEach((ym) => tasks.push(() => fetchRegionMonth(serviceKey, r.code, ym))));
  const results = await runPool(tasks, 8); // 국토부 초당 요청 한도 때문에 8개씩

  // 저장값이 커질 수 있어 10개씩 나눠 읽는다
  const prevSeen = {};
  const prevMax = {};
  for (const part of chunks(regions, 10)) {
    // eslint-disable-next-line no-await-in-loop
    Object.assign(prevSeen, await kvMGet(part.map((r) => `${SEEN}${r.code}`)));
    // eslint-disable-next-line no-await-in-loop
    Object.assign(prevMax, await kvMGet(part.map((r) => `${MAX}${r.code}`)));
  }

  const perRegion = [];
  const failed = [];
  const baseline = [];
  const writes = [];
  const maxMaps = {};
  regions.forEach((r, ri) => {
    const before = prevMax[`${MAX}${r.code}`] || null;
    maxMaps[r.code] = before ? { ...before } : {};
    const chunk = results.slice(ri * months.length, (ri + 1) * months.length);
    if (chunk.some((x) => !Array.isArray(x))) { failed.push(r.code); return; } // 한 달이라도 실패하면 그 지역은 오늘 건너뜀(내일 다시 비교)
    const trades = chunk.flat();
    const seen = prevSeen[`${SEEN}${r.code}`];
    if (!seen) {
      baseline.push(r.code); // 처음 도는 날은 기준만 저장(새 거래로 치지 않음)
    } else {
      perRegion.push({ code: r.code, sido: r.sido, newTrades: diffNew(seen.counts, trades), maxBefore: before });
    }
    writes.push([`${SEEN}${r.code}`, { months, counts: countsOf(trades), at: date }]);
    updateMax(maxMaps[r.code], trades);
  });

  // 신고가 판단은 위 maxBefore(오늘 채우기 전 기록)로 이미 끝났다. 이제 남는 시간에 과거를 채운다.
  const bfPrev = (await kvGet(BACKFILL)) || null;
  const baseYm = bfPrev?.baseYm || monthsBefore(months[0], 1)[0]; // 처음 정한 기준 달에서 거꾸로(달이 바뀌어도 순서가 밀리지 않게)
  const backMonths = [baseYm, ...monthsBefore(baseYm, BACK_MONTHS - 1)];
  const bfTotal = regions.length * backMonths.length;
  let bfDone = bfPrev?.done || 0;
  let bfError = '';
  try {
    while (bfDone < bfTotal && Date.now() - started < DEADLINE_MS) {
      const ids = [];
      for (let k = 0; k < 16 && bfDone + k < bfTotal; k += 1) ids.push(bfDone + k);
      // eslint-disable-next-line no-await-in-loop
      const rs = await runPool(ids.map((i) => {
        const { regionIdx, ym } = backfillTask(i, regions.length, backMonths);
        return () => fetchRegionMonth(serviceKey, regions[regionIdx].code, ym);
      }), 8);
      let ok = 0;
      for (let k = 0; k < rs.length; k += 1) {
        if (!Array.isArray(rs[k])) break; // 실패한 자리에서 멈추고 다음 날 그 자리부터
        updateMax(maxMaps[regions[backfillTask(ids[k], regions.length, backMonths).regionIdx].code], rs[k]);
        ok += 1;
      }
      bfDone += ok;
      if (ok < rs.length) { bfError = '국토부 응답 오류로 멈춤'; break; }
    }
  } catch (e) {
    bfError = '과거 채우기 중 오류';
  }
  const lastDone = bfDone > 0 ? backfillTask(bfDone - 1, regions.length, backMonths).ym : null;
  const backfill = { baseYm, done: bfDone, total: bfTotal, reachedYm: lastDone, error: bfError, at: date };

  regions.forEach((r) => writes.push([`${MAX}${r.code}`, maxMaps[r.code]]));
  const report = buildDailyReport({ date, perRegion, months, failed, baseline });
  report.ranAt = new Date().toISOString();
  report.regions = regions.length;
  report.backfill = backfill;
  const nextIndex = [date, ...index.filter((d) => d !== date)].slice(0, 90);
  writes.push([`daily:report:${date}`, report]);
  writes.push([BACKFILL, backfill]);
  // v257: 날짜별 추이 요약(작아서 한 번에 읽힌다). 읽기 실패해도 본 작업은 계속.
  let stats = [];
  try { stats = (await kvGet(STATS)) || []; } catch (e) { stats = []; }
  writes.push([STATS, appendStat(stats, report)]);
  writes.push([INDEX, nextIndex]); // 목록은 맨 마지막에(앞 저장이 실패하면 오늘을 "했음"으로 남기지 않게)
  // 저장소 한 번 요청이 1MB를 넘지 않게 크기로 묶어 저장(최고가 기록은 3년 치가 쌓이면 지역당 수백 KB까지 커진다)
  let group = []; let bytes = 0;
  for (const w of writes) {
    const size = JSON.stringify(w[1]).length * 2; // 한글이 섞여 대략 2배로 잡는다
    if (group.length && bytes + size > 700000) {
      // eslint-disable-next-line no-await-in-loop
      await kvMSet(group);
      group = []; bytes = 0;
    }
    group.push(w); bytes += size;
  }
  if (group.length) await kvMSet(group);

  return Response.json({
    date, months, regions: regions.length, total: report.total, highs: report.highCount,
    failed: failed.length, baseline: baseline.length, backfill: { done: bfDone, total: bfTotal, reachedYm: lastDone }, ms: Date.now() - started,
  });
}

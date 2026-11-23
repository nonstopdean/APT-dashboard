import { fetchRegionMonth, runPool } from '../../../lib/molit';
import { REGION_GROUPS } from '../../../lib/regions';
import {
  kvReady, kvGet, kvMGet, kvMSet,
} from '../../../lib/kv';
import {
  leafRegions, countsOf, diffNew, updateMax, buildDailyReport, kstDate, monthsToFetch,
} from '../../../lib/daily-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// v250: 매일 아침(vercel.json 크론, 한국 시간 8시) 수도권 아파트 매매를 받아 전날 저장본과 비교해 "새로 공개된 거래"를 저장한다.
// 저장 키: daily:seen:<지역> = { months, counts }(거래 지문 개수), daily:max:<지역> = 단지·면적별 최고가,
//          daily:report:<YYYYMMDD> = 그날 리포트, daily:index = 리포트 날짜 목록(최근 90개).
// 하루 한 번만 돈다(같은 날 다시 부르면 건너뜀). CRON_SECRET을 설정하면 그 값이 있는 요청(Vercel 크론)만 받는다.
const SEEN = 'daily:seen:';
const MAX = 'daily:max:';
const INDEX = 'daily:index';

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

  const prevSeen = await kvMGet(regions.map((r) => `${SEEN}${r.code}`));
  const prevMax = await kvMGet(regions.map((r) => `${MAX}${r.code}`));

  const perRegion = [];
  const failed = [];
  const baseline = [];
  const writes = [];
  regions.forEach((r, ri) => {
    const chunk = results.slice(ri * months.length, (ri + 1) * months.length);
    if (chunk.some((x) => !Array.isArray(x))) { failed.push(r.code); return; } // 한 달이라도 실패하면 그 지역은 오늘 건너뜀(내일 다시 비교)
    const trades = chunk.flat();
    const seen = prevSeen[`${SEEN}${r.code}`];
    const maxBefore = prevMax[`${MAX}${r.code}`] || null;
    if (!seen) {
      baseline.push(r.code); // 처음 도는 날은 기준만 저장(새 거래로 치지 않음)
    } else {
      perRegion.push({ code: r.code, sido: r.sido, newTrades: diffNew(seen.counts, trades), maxBefore });
    }
    writes.push([`${SEEN}${r.code}`, { months, counts: countsOf(trades), at: date }]);
    writes.push([`${MAX}${r.code}`, updateMax(maxBefore ? { ...maxBefore } : {}, trades)]);
  });

  const report = buildDailyReport({ date, perRegion, months, failed, baseline });
  report.ranAt = new Date().toISOString();
  report.regions = regions.length;
  const nextIndex = [date, ...index.filter((d) => d !== date)].slice(0, 90);
  writes.push([`daily:report:${date}`, report]);
  writes.push([INDEX, nextIndex]);
  // 한 번에 너무 크지 않게 나눠 저장
  for (let i = 0; i < writes.length; i += 20) {
    // eslint-disable-next-line no-await-in-loop
    await kvMSet(writes.slice(i, i + 20));
  }

  return Response.json({
    date, months, regions: regions.length, total: report.total, highs: report.highCount,
    failed: failed.length, baseline: baseline.length, ms: Date.now() - started,
  });
}

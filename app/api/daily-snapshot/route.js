import { fetchRegionMonth, runPool } from '../../../lib/molit';
import { REGION_GROUPS } from '../../../lib/regions';
import {
  kvReady, kvGet, kvMGet, kvMSet, kvSet,
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
// v259: 11/24 아침 리포트가 저장되지 않았다(채우기까지 끝낸 뒤 한꺼번에 저장하는 구조라 60초를 넘기면 전부 사라짐).
//       순서를 바꿨다 — ① 그날 리포트·기준·목록을 먼저 저장 ② 남는 시간(시작 40초까지)에만 과거 채우기 ③ 최고가·진행 위치 저장.
//       국토부 요청마다 시간 제한을 두고(늦으면 실패로 치고 넘어감), 단계 기록 daily:lastrun을 남긴다(daily-report API로 보임).
const SEEN = 'daily:seen:';
const MAX = 'daily:max:';
const INDEX = 'daily:index';
const BACKFILL = 'daily:backfill';
const STATS = 'daily:stats'; // v257: [{ d, t, h, s: {서울,인천,경기}, f }] 최신이 앞
const LASTRUN = 'daily:lastrun'; // v259: { date, stage, ms, ... } 마지막 실행이 어디까지 갔는지
const BACK_MONTHS = 34; // 오늘 받는 2개월 + 34개월 = 약 3년
const FAILED_LAST = 'daily:failedlast'; // v260: 지난번에 못 받은 지역(다음 실행 때 맨 먼저 받는다)
const MAIN_TASK_MS = 20000; // 오늘 자료 한 건(지역·달) 최대 대기
// v260: 11/24 실행에서 32초 안에 서울·인천만 받고 경기 46곳이 빠졌다(8개씩, 한 번에 약 3.5초) → 12개씩, 46초까지.
//       과거 채우기는 오늘 자료가 40초 전에 끝났을 때만 돈다.
const MAIN_UNTIL_MS = 46000; // 오늘 자료 받기는 시작 후 이 시간 안에 끝낸다
const MAIN_POOL = 12;
const BACK_TASK_MS = 8000; // 과거 채우기 한 건 최대 대기
const BACKFILL_UNTIL_MS = 40000; // 시작 후 이 시간이 지나면 과거 채우기를 새로 시작하지 않는다

const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
// 시간 제한: 늦으면 { error: 'timeout' }으로 끝낸다(원래 요청은 버려진다)
const withTimeout = (fn, ms) => () => Promise.race([
  Promise.resolve().then(fn),
  new Promise((resolve) => { setTimeout(() => resolve({ error: 'timeout' }), ms); }),
]);
// 저장소 한 번 요청이 1MB를 넘지 않게 크기로 묶어 저장
async function writeGrouped(writes) {
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
}

export async function GET(request) {
  const rawSecret = process.env.CRON_SECRET || '';
  const secret = rawSecret.trim();
  const got = request.headers.get('authorization') || '';
  // v259: 값 앞뒤에 공백이 섞여 저장됐어도 크론 요청을 받도록 원래 값·다듬은 값 둘 다 비교
  const authed = Boolean(secret) && (got === `Bearer ${secret}` || got === `Bearer ${rawSecret}` || got.trim() === `Bearer ${secret}`);
  if (secret && !authed) return Response.json({ error: '인증 실패' }, { status: 401 });
  if (!kvReady()) return Response.json({ error: '저장소(KV)가 연결되지 않았어요.' }, { status: 500 });
  const serviceKey = (process.env.MOLIT_SERVICE_KEY || '').trim();
  if (!serviceKey) return Response.json({ error: '서버 설정이 필요해요.' }, { status: 500 });

  const started = Date.now();
  const date = kstDate();
  const force = new URL(request.url).searchParams.get('force') === '1' && authed;
  const index = (await kvGet(INDEX)) || [];
  if (index.includes(date) && !force) return Response.json({ skipped: '오늘은 이미 저장했어요', date });
  const mark = (stage, extra = {}) => kvSet(LASTRUN, { date, stage, ms: Date.now() - started, at: new Date().toISOString(), ...extra }).catch(() => {});
  await mark('start');

  // ① 오늘 자료
  const regions = leafRegions(REGION_GROUPS);
  const months = monthsToFetch();
  // 지난번에 못 받은 지역을 맨 앞에(시간이 모자라도 같은 지역만 계속 빠지지 않게)
  let failedLast = [];
  try { failedLast = (await kvGet(FAILED_LAST)) || []; } catch (e) { failedLast = []; }
  const firstSet = new Set(Array.isArray(failedLast) ? failedLast : []);
  const ordered = [...regions.filter((r) => firstSet.has(r.code)), ...regions.filter((r) => !firstSet.has(r.code))];
  const tasks = [];
  // 오늘 자료는 시작 후 MAIN_UNTIL_MS 안에 끝낸다 — 그때까지 못 받은 지역은 실패로 치고(내일 다시) 저장으로 넘어간다
  const mainTask = (code, ym) => () => {
    const left = MAIN_UNTIL_MS - (Date.now() - started);
    if (left < 1000) return Promise.resolve({ error: 'deadline' });
    return withTimeout(() => fetchRegionMonth(serviceKey, code, ym), Math.min(MAIN_TASK_MS, left))();
  };
  ordered.forEach((r) => months.forEach((ym) => tasks.push(mainTask(r.code, ym))));
  const results = await runPool(tasks, MAIN_POOL);
  await mark('fetched', { failedTasks: results.filter((x) => !Array.isArray(x)).length });

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
  ordered.forEach((r, ri) => {
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

  const bfPrev = (await kvGet(BACKFILL)) || null;
  const baseYm = bfPrev?.baseYm || monthsBefore(months[0], 1)[0]; // 처음 정한 기준 달에서 거꾸로(달이 바뀌어도 순서가 밀리지 않게)
  const backMonths = [baseYm, ...monthsBefore(baseYm, BACK_MONTHS - 1)];
  const bfTotal = regions.length * backMonths.length;
  let bfDone = bfPrev?.done || 0;

  const report = buildDailyReport({ date, perRegion, months, failed, baseline });
  report.ranAt = new Date().toISOString();
  report.regions = regions.length;
  report.backfill = { baseYm, done: bfDone, total: bfTotal, reachedYm: bfPrev?.reachedYm || null, error: '', at: date };
  let stats = [];
  try { stats = (await kvGet(STATS)) || []; } catch (e) { stats = []; }
  const nextIndex = [date, ...index.filter((d) => d !== date)].slice(0, 90);

  // ② 그날 결과를 먼저 저장(최고가는 오늘 거래까지 반영한 것). 목록(index)은 맨 마지막에.
  regions.forEach((r) => writes.push([`${MAX}${r.code}`, maxMaps[r.code]]));
  writes.push([`daily:report:${date}`, report]);
  writes.push([STATS, appendStat(stats, report)]);
  writes.push([FAILED_LAST, failed]);
  writes.push([INDEX, nextIndex]);
  await writeGrouped(writes);
  await mark('saved', { total: report.total, failed: failed.length });

  // ③ 남는 시간에 과거 채우기 — 신고가 판단은 위에서 maxBefore로 이미 끝났다.
  let bfError = '';
  const touched = new Set();
  try {
    while (bfDone < bfTotal && Date.now() - started < BACKFILL_UNTIL_MS) {
      const ids = [];
      for (let k = 0; k < 8 && bfDone + k < bfTotal; k += 1) ids.push(bfDone + k);
      // eslint-disable-next-line no-await-in-loop
      const rs = await runPool(ids.map((i) => {
        const { regionIdx, ym } = backfillTask(i, regions.length, backMonths);
        const left = 50000 - (Date.now() - started); // 채우기 요청도 시작 후 50초를 넘기지 않게
        return withTimeout(() => fetchRegionMonth(serviceKey, regions[regionIdx].code, ym), Math.max(500, Math.min(BACK_TASK_MS, left)));
      }), 8);
      let ok = 0;
      for (let k = 0; k < rs.length; k += 1) {
        if (!Array.isArray(rs[k])) break; // 실패한 자리에서 멈추고 다음 날 그 자리부터
        const code = regions[backfillTask(ids[k], regions.length, backMonths).regionIdx].code;
        updateMax(maxMaps[code], rs[k]);
        touched.add(code);
        ok += 1;
      }
      bfDone += ok;
      if (ok < rs.length) { bfError = '국토부 응답 오류·지연으로 멈춤'; break; }
    }
  } catch (e) {
    bfError = '과거 채우기 중 오류';
  }
  const lastDone = bfDone > 0 ? backfillTask(bfDone - 1, regions.length, backMonths).ym : null;
  const backfill = { baseYm, done: bfDone, total: bfTotal, reachedYm: lastDone, error: bfError, at: date };
  report.backfill = backfill;

  const late = [...touched].map((code) => [`${MAX}${code}`, maxMaps[code]]);
  late.push([BACKFILL, backfill]);
  late.push([`daily:report:${date}`, report]);
  try {
    await writeGrouped(late);
    await mark('done', { total: report.total, backfillDone: bfDone });
  } catch (e) {
    await mark('backfill-save-failed', { total: report.total });
  }

  return Response.json({
    date, months, regions: regions.length, total: report.total, highs: report.highCount,
    failed: failed.length, baseline: baseline.length, backfill: { done: bfDone, total: bfTotal, reachedYm: lastDone }, ms: Date.now() - started,
  });
}

import { fetchRegionMonth, runPool } from '../../../lib/molit';
import { REGION_GROUPS } from '../../../lib/regions';
import {
  kvReady, kvGet, kvMGet, kvMSet, kvSet,
} from '../../../lib/kv';
import {
  leafRegions, updateMax, kstDate, monthsToFetch, monthsBefore, backfillTask, makeGate, failKind,
} from '../../../lib/daily-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// v262: 일일 신고의 "과거 3년 최고가" 채우기를 따로 도는 새벽 크론(vercel.json, 한국 시간 03:00).
// 아침 작업(daily-snapshot)은 오늘 자료를 받느라 남는 시간이 거의 없어 11/23~25 동안 0/2788에서 움직이지 않았다.
// 진행 위치는 아침 작업과 같은 daily:backfill(baseYm·done)을 이어 쓰고, 채운 지역의 daily:max만 고쳐 저장한다.
// 결과 기록 daily:bflastrun { date, stage, ms, done, added, why } — /api/daily-report가 bflastrun으로 준다.
const MAX = 'daily:max:';
const BACKFILL = 'daily:backfill';
const BF_LASTRUN = 'daily:bflastrun';
const BACK_MONTHS = 34; // daily-snapshot과 같은 값
const UNTIL_MS = 42000; // 새 묶음은 시작 후 이 시간까지만 시작
const TASK_MS = 10000; // 한 건 최대 대기
const POOL = 4; // v265: 8 → 4
const BATCH = 8; // 한 번에 계획하는 작업 수
const GAP_MS = 170; // v265: 국토부 요청 사이 최소 간격(11/26 새벽 155건째에 국토부 오류로 멈춤)
const MAX_FAIL_ROUNDS = 3; // v265: 국토부 오류로 실패한 묶음은 3초 쉬고 다시(최대 3번)

const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const withTimeout = (fn, ms) => () => Promise.race([
  Promise.resolve().then(fn),
  new Promise((resolve) => { setTimeout(() => resolve({ error: 'timeout' }), ms); }),
]);
async function writeGrouped(writes) {
  let group = []; let bytes = 0;
  for (const w of writes) {
    const size = JSON.stringify(w[1]).length * 2;
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
  const authed = Boolean(secret) && (got === `Bearer ${secret}` || got === `Bearer ${rawSecret}` || got.trim() === `Bearer ${secret}`);
  if (secret && !authed) return Response.json({ error: '인증 실패' }, { status: 401 });
  if (!kvReady()) return Response.json({ error: '저장소(KV)가 연결되지 않았어요.' }, { status: 500 });
  const serviceKey = (process.env.MOLIT_SERVICE_KEY || '').trim();
  if (!serviceKey) return Response.json({ error: '서버 설정이 필요해요.' }, { status: 500 });

  const started = Date.now();
  const date = kstDate();
  const mark = (stage, extra = {}) => kvSet(BF_LASTRUN, { date, stage, ms: Date.now() - started, at: new Date().toISOString(), ...extra }).catch(() => {});

  const regions = leafRegions(REGION_GROUPS);
  const bfPrev = (await kvGet(BACKFILL)) || null;
  const baseYm = bfPrev?.baseYm || monthsBefore(monthsToFetch()[0], 1)[0];
  const backMonths = [baseYm, ...monthsBefore(baseYm, BACK_MONTHS - 1)];
  const total = regions.length * backMonths.length;
  const startDone = bfPrev?.done || 0;
  if (startDone >= total) {
    await mark('complete', { done: startDone, total });
    return Response.json({ done: startDone, total, skipped: '이미 다 채웠어요' });
  }
  await mark('start', { done: startDone, total });

  // 채울 지역의 기존 최고가 기록은 필요할 때 10개씩 읽는다
  const maxMaps = {};
  const loadMax = async (codes) => {
    const need = codes.filter((c) => !(c in maxMaps));
    for (const part of chunks(need, 10)) {
      // eslint-disable-next-line no-await-in-loop
      const got2 = await kvMGet(part.map((c) => `${MAX}${c}`));
      part.forEach((c) => { maxMaps[c] = got2[`${MAX}${c}`] ? { ...got2[`${MAX}${c}`] } : {}; });
    }
  };

  let done = startDone;
  let added = 0;
  let error = '';
  const why = {};
  const touched = new Set();
  const gate = makeGate(GAP_MS);
  let failRounds = 0;
  try {
    while (done < total && Date.now() - started < UNTIL_MS) {
      const ids = [];
      for (let k = 0; k < BATCH && done + k < total; k += 1) ids.push(done + k);
      const plan = ids.map((i) => {
        const { regionIdx, ym } = backfillTask(i, regions.length, backMonths);
        return { code: regions[regionIdx].code, ym };
      });
      // eslint-disable-next-line no-await-in-loop
      await loadMax(plan.map((p) => p.code));
      // eslint-disable-next-line no-await-in-loop
      const rs = await runPool(plan.map((p) => withTimeout(async () => { await gate(); return fetchRegionMonth(serviceKey, p.code, p.ym, { strict: true }); }, TASK_MS)), POOL);
      let ok = 0;
      for (let k = 0; k < rs.length; k += 1) {
        const x = rs[k];
        if (!Array.isArray(x)) {
          const key = failKind(x);
          why[key] = (why[key] || 0) + 1;
          break; // 실패한 자리에서 멈추고 그 자리부터 다시
        }
        const before = Object.keys(maxMaps[plan[k].code]).length;
        updateMax(maxMaps[plan[k].code], x);
        added += Object.keys(maxMaps[plan[k].code]).length - before;
        touched.add(plan[k].code);
        ok += 1;
      }
      done += ok;
      if (ok < rs.length) {
        failRounds += 1;
        if (failRounds >= MAX_FAIL_ROUNDS || Date.now() - started > UNTIL_MS - 4000) { error = '국토부 응답 오류·지연으로 멈춤'; break; }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => { setTimeout(r, 3000); });
      }
    }
  } catch (e) {
    error = '과거 채우기 중 오류';
  }

  const lastDone = done > 0 ? backfillTask(done - 1, regions.length, backMonths).ym : null;
  const backfill = { baseYm, done, total, reachedYm: lastDone, error, at: date };
  try {
    // 최고가 먼저, 진행 위치는 마지막(중간에 끊겨도 같은 자리를 다시 채울 뿐 건너뛰지 않게)
    await writeGrouped([...[...touched].map((c) => [`${MAX}${c}`, maxMaps[c]]), [BACKFILL, backfill]]);
    await mark('done', { done, total, from: startDone, added, why, error });
  } catch (e) {
    await mark('save-failed', { done: startDone, total, why });
  }
  return Response.json({ from: startDone, done, total, reachedYm: lastDone, added, error, ms: Date.now() - started });
}

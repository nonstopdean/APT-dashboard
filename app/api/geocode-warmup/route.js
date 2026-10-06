import { fetchAptListBySigungu, geocodeViaKakaoRest } from '../../../lib/molit';
import { kvReady } from '../../../lib/kv';
import { expandRegionCode, regionLabel } from '../../../lib/regions';
import { placeContextOf } from '../../../lib/geocode-pick';
import { readCoords, writeCoords } from '../../../lib/geocode-store';
import { warmRegion } from '../../../lib/geocode-warm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 한 번 부를 때 쓸 수 있는 시간(ms). 서버 제한(60초)에 걸려 통째로 죽기 전에 스스로 멈추고,
// partial=true와 이어서 부를 위치(member, start)를 돌려준다 → 관리자 페이지가 이어서 다시 부른다.
// 환경변수 WARMUP_BUDGET_MS로 조절할 수 있다(기본 45초).
const DEFAULT_BUDGET_MS = 45000;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = (searchParams.get('code') || '').trim();
  const force = searchParams.get('force') === '1'; // 이미 저장된 단지도 다시 찾는다(잘못 저장된 값을 고칠 때)
  const startMember = Math.max(0, parseInt(searchParams.get('member') || '0', 10) || 0);
  const startIndex = Math.max(0, parseInt(searchParams.get('start') || '0', 10) || 0);

  const molitKey = (process.env.MOLIT_SERVICE_KEY || '').trim();
  const kakaoRestKey = (process.env.KAKAO_REST_API_KEY || '').trim();
  if (!molitKey) {
    return Response.json({ error: 'MOLIT_SERVICE_KEY 환경변수가 없습니다.' }, { status: 500 });
  }
  if (!kakaoRestKey) {
    return Response.json({ error: 'KAKAO_REST_API_KEY 환경변수가 없습니다.' }, { status: 500 });
  }
  if (!kvReady()) {
    return Response.json({ error: 'Vercel KV(저장소)가 설정되어 있지 않습니다.' }, { status: 500 });
  }
  if (!code) {
    return Response.json({ error: 'code(지역 코드)가 필요합니다. 예: ?code=11680' }, { status: 400 });
  }

  const BUDGET_MS = Number(process.env.WARMUP_BUDGET_MS) || DEFAULT_BUDGET_MS;
  const members = expandRegionCode(code);
  const t0 = Date.now();
  const total = { totalComplexes: 0, cached: 0, newlyFound: 0, notFound: 0, found: 0 };
  const perRegion = [];
  let resume = null;

  for (let m = startMember; m < members.length; m += 1) {
    const regionCode = members[m];
    const remainingMs = BUDGET_MS - (Date.now() - t0);
    // 시간이 거의 안 남았으면 새 지역을 시작하지 않고 다음 호출로 넘긴다.
    if (remainingMs < Math.min(3000, BUDGET_MS / 4)) { resume = { member: m, start: 0 }; break; }
    // eslint-disable-next-line no-await-in-loop
    const list = await fetchAptListBySigungu(molitKey, regionCode);
    const regionName = regionLabel(regionCode);
    // eslint-disable-next-line no-await-in-loop
    const r = await warmRegion({
      regionCode,
      list,
      start: m === startMember ? startIndex : 0,
      force,
      budgetMs: remainingMs,
      geocode: async (item) => {
        const ctx = { place: placeContextOf(regionCode), dong: item.dong, aptName: item.kaptName };
        return await geocodeViaKakaoRest(kakaoRestKey, `${regionName} ${item.dong} ${item.kaptName}`, ctx)
          || await geocodeViaKakaoRest(kakaoRestKey, `${item.dong} ${item.kaptName}`, ctx)
          || await geocodeViaKakaoRest(kakaoRestKey, item.kaptName, ctx);
      },
      // 저장·조회는 lib/geocode-store.js를 거친다 → 표기가 다른 이름으로도 찾아지는 identity 키로 저장된다.
      store: { read: (keys) => readCoords(keys, { migrate: false }), write: writeCoords },
    });
    ['totalComplexes', 'cached', 'newlyFound', 'notFound', 'found'].forEach((k) => { total[k] += r[k]; });
    perRegion.push({ regionCode, regionName, complexCount: list.length, found: r.found, newlyFound: r.newlyFound, notFound: r.notFound });
    if (r.partial) { resume = { member: m, start: r.nextStart }; break; }
  }

  return Response.json({ ...total, perRegion, partial: resume != null, resume });
}

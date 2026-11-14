import { publicError } from '../../../lib/safe-error';
import { fetchRoneAllRegions } from '../../../lib/rone';
import { LAWD_TO_CLS, SIDO_REGIONS } from '../../../lib/rone-regions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

// v232: 지도 말풍선(시·도·시군구)용 — 한국부동산원 (월) 아파트 평균매매가격을 모든 지역 한 번에.
// 최근 4개월을 받아 지역마다 가장 최근 달 값과 그 전 달 값을 돌려준다. { ym, items: { [우리 지역코드]: { v, prev, ym } } }
const STATBL_ID = 'A_2024_00060';
const ITM_ID = '100001';

const ymShift = (d, n) => {
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
  return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}`;
};

export async function GET() {
  const key = (process.env.RONE_SERVICE_KEY || '').trim();
  if (!key) return Response.json({ error: '서버에 RONE_SERVICE_KEY 환경변수가 설정되지 않았습니다.' }, { status: 500 });
  const now = new Date();
  try {
    const rows = await fetchRoneAllRegions({ key, statblId: STATBL_ID, itmId: ITM_ID, startYm: ymShift(now, -4), endYm: ymShift(now, 0) });
    const codesByCls = new Map();
    Object.entries(LAWD_TO_CLS).forEach(([code, cls]) => {
      if (!codesByCls.has(cls)) codesByCls.set(cls, []);
      codesByCls.get(cls).push(code);
    });
    SIDO_REGIONS.forEach((r) => {
      if (!codesByCls.has(r.clsId)) codesByCls.set(r.clsId, []);
      codesByCls.get(r.clsId).push(r.code);
    });
    const byCls = new Map(); // clsId → [{ym, value}] 최신순
    rows.forEach((r) => {
      if (!Number.isFinite(r.value) || !codesByCls.has(r.clsId)) return;
      if (!byCls.has(r.clsId)) byCls.set(r.clsId, []);
      byCls.get(r.clsId).push(r);
    });
    const items = {};
    let latestYm = '';
    byCls.forEach((list, cls) => {
      list.sort((a, b) => String(b.ym).localeCompare(String(a.ym)));
      const cur = list[0];
      const prev = list[1];
      if (cur.ym > latestYm) latestYm = cur.ym;
      codesByCls.get(cls).forEach((code) => {
        items[code] = { v: Math.round(cur.value), prev: prev ? Math.round(prev.value) : null, ym: cur.ym };
      });
    });
    return Response.json(
      { ym: latestYm, count: Object.keys(items).length, items },
      { headers: { 'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=3600' } },
    );
  } catch (e) {
    return Response.json({ error: publicError(e, '부동산원 평균매매가격을 불러오지 못했습니다.') }, { status: 500 });
  }
}

import { fetchRoneSeries } from '../../../lib/rone';
import { getClsId } from '../../../lib/rone-regions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATBL_ID = 'A_2024_00060'; // (월) 평균매매가격_아파트
const ITM_ID = '100001'; // 가격

function lastNMonthsYm(n) {
  const arr = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i++) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    arr.unshift(`${y}${m}`);
    d.setMonth(d.getMonth() - 1);
  }
  return arr;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const codes = (searchParams.get('codes') || '').split(',').map((c) => c.trim()).filter(Boolean);
  const monthCount = Math.min(Math.max(parseInt(searchParams.get('months') || '6', 10), 1), 24);

  const key = (process.env.RONE_SERVICE_KEY || '').trim();
  if (!key) {
    return Response.json(
      { error: '서버에 RONE_SERVICE_KEY 환경변수가 설정되지 않았습니다.' },
      { status: 500 },
    );
  }
  if (codes.length === 0) {
    return Response.json({ error: '지역 코드가 1개 이상 필요합니다.' }, { status: 400 });
  }

  const months = lastNMonthsYm(monthCount);
  const startYm = months[0];
  const endYm = months[months.length - 1];

  const unmapped = codes.filter((c) => !getClsId(c));
  const mappedCodes = codes.filter((c) => getClsId(c));

  const data = {};
  let errorMsg = null;

  await Promise.all(mappedCodes.map(async (code) => {
    try {
      const series = await fetchRoneSeries({
        key, statblId: STATBL_ID, itmId: ITM_ID, clsId: getClsId(code), startYm, endYm,
      });
      data[code] = series;
    } catch (e) {
      errorMsg = errorMsg || e.message;
      data[code] = [];
    }
  }));

  return Response.json({
    data, months, unmapped, error: errorMsg, fetchedAt: new Date().toISOString(),
  });
}

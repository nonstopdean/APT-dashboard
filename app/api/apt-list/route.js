import { fetchAptListBySigungu } from '../../../lib/molit';
import { expandRegionCode } from '../../../lib/regions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const codes = (searchParams.get('codes') || '').split(',').map((c) => c.trim()).filter(Boolean);

  const serviceKey = (process.env.MOLIT_SERVICE_KEY || '').trim();
  if (!serviceKey) {
    return Response.json(
      { error: '서버에 MOLIT_SERVICE_KEY 환경변수가 설정되지 않았습니다.' },
      { status: 500 },
    );
  }
  if (codes.length === 0) {
    return Response.json({ error: '지역 코드가 1개 이상 필요합니다.' }, { status: 400 });
  }

  const memberSet = new Set();
  codes.forEach((code) => expandRegionCode(code).forEach((mc) => memberSet.add(mc)));
  // 시/도 전체처럼 한 번에 수십 개 구가 펼쳐지면 단지 목록 조회량이 너무 커져서 느려지므로,
  // 지도 마커용으로는 앞쪽 일부 지역만 가져온다 (실거래가 있는 지역은 allTx 쪽에서 이미 커버됨).
  const members = [...memberSet].slice(0, 8);

  const data = {};
  let errorMsg = null;
  await Promise.all(members.map(async (code) => {
    try {
      data[code] = await fetchAptListBySigungu(serviceKey, code);
    } catch (e) {
      errorMsg = errorMsg || e.message;
      data[code] = [];
    }
  }));

  return Response.json({ data, error: errorMsg });
}

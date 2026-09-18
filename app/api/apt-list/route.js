import { fetchAptListBySigungu } from '../../../lib/molit';
import { expandRegionCode } from '../../../lib/regions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

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
  // 시/도 전체처럼 한 번에 수십 개 구가 펼쳐지면 단지 목록 조회량이 커지지만, 병렬로 가져오고
  // 지도 마커도 이제 좌표 검색이 거의 필요 없어 가벼워졌으므로 한 시/도 전체 정도는 감당할 수 있다.
  const members = [...memberSet].slice(0, 30);

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

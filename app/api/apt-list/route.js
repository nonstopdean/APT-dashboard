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
  const members = [...memberSet];

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

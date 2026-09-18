import { searchPnu, fetchApartHousingPrice } from '../../../lib/vworld';
import { regionLabel } from '../../../lib/regions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const regionCode = (searchParams.get('regionCode') || '').trim();
  const dong = (searchParams.get('dong') || '').trim();
  const jibun = (searchParams.get('jibun') || '').trim();
  const aptDong = (searchParams.get('aptDong') || '').trim();

  const vworldKey = (process.env.VWORLD_API_KEY || '').trim();
  if (!vworldKey) {
    return Response.json({ error: '서버에 VWORLD_API_KEY 환경변수가 설정되지 않았습니다.' }, { status: 500 });
  }
  if (!regionCode || !dong || !jibun) {
    return Response.json({ error: 'regionCode, dong, jibun이 필요합니다.' }, { status: 400 });
  }

  try {
    const address = `${regionLabel(regionCode)} ${dong} ${jibun}`;
    const pnu = await searchPnu(vworldKey, address);
    if (!pnu) {
      return Response.json({ error: '주소로 고유번호(PNU)를 찾지 못했습니다.', address });
    }
    const rows = await fetchApartHousingPrice(vworldKey, pnu, aptDong || undefined);
    return Response.json({ pnu, address, rows });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

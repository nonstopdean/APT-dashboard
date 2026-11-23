import { publicError } from '../../../lib/safe-error';
import { searchPnu, fetchApartHousingPrice } from '../../../lib/vworld';
import { regionLabel } from '../../../lib/regions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;
// v221: 브이월드가 해외(미국) 서버의 요청에 HTTP 502를 돌려줘서 공시가격이 전부 실패했다(한국에서 같은 요청은 정상).
// 이 함수만 서울 지역에서 실행한다. (v258: Hobby라 무시돼서 2026-11-23 프로젝트 Function Region 자체를 icn1로 바꿈)
export const preferredRegion = 'icn1';

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
    // v258: 결과가 비면 응답 모양 요약(diag: 키 이름·결과 코드·건수만)을 같이 준다
    // v258b: domain 후보 — 환경변수 VWORLD_DOMAIN(있으면) → 이 사이트 주소(https 포함/미포함) → 예전 값 'vworld'
    const host = (request.headers.get('host') || '').trim().toLowerCase();
    const okHost = /^[a-z0-9.-]{3,100}$/.test(host) ? host : '';
    const domains = [
      (process.env.VWORLD_DOMAIN || '').trim(),
      okHost && `https://${okHost}`, okHost, 'https://apt-dashboard-five.vercel.app', 'apt-dashboard-five.vercel.app', 'vworld',
    ].filter(Boolean);
    const { rows, diag } = await fetchApartHousingPrice(vworldKey, pnu, aptDong || undefined, undefined, domains);
    return Response.json({ pnu, address, rows, ...(rows.length ? {} : { diag }) });
  } catch (e) {
    return Response.json({ error: publicError(e, '공시가격을 불러오지 못했습니다.') }, { status: 500 });
  }
}

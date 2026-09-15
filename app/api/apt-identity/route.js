import { fetchAptIdentityByAddress } from '../../../lib/molit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();

  const serviceKey = (process.env.MOLIT_SERVICE_KEY || '').trim();
  if (!serviceKey) {
    return Response.json(
      { error: '서버에 MOLIT_SERVICE_KEY 환경변수가 설정되지 않았습니다.' },
      { status: 500 },
    );
  }
  if (!q) {
    return Response.json({ error: 'q(검색어)가 필요합니다.' }, { status: 400 });
  }

  try {
    const rows = await fetchAptIdentityByAddress(serviceKey, q);
    return Response.json({ rows });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

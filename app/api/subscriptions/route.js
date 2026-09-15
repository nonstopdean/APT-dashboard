import { fetchAptSubscriptions } from '../../../lib/applyhome';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const sido = (searchParams.get('sido') || '').trim();
  const from = (searchParams.get('from') || '').trim();

  const serviceKey = (process.env.MOLIT_SERVICE_KEY || '').trim();
  if (!serviceKey) {
    return Response.json(
      { error: '서버에 MOLIT_SERVICE_KEY 환경변수가 설정되지 않았습니다.' },
      { status: 500 },
    );
  }

  try {
    const rows = await fetchAptSubscriptions(serviceKey, sido, from);
    return Response.json({ rows });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

import { fetchKosisPopulation } from '../../../lib/kosis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const sido = (searchParams.get('sido') || '').trim();

  const apiKey = (process.env.KOSIS_API_KEY || '').trim();
  if (!apiKey) {
    return Response.json({ error: '서버에 KOSIS_API_KEY 환경변수가 설정되지 않았습니다.' }, { status: 500 });
  }
  if (!sido) {
    return Response.json({ error: 'sido가 필요합니다.' }, { status: 400 });
  }

  try {
    const rows = await fetchKosisPopulation(apiKey, sido, 24);
    return Response.json({ rows });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

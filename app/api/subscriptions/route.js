import { publicError } from '../../../lib/safe-error';
import { fetchAptSubscriptions, fetchAptSubscriptionsAll } from '../../../lib/applyhome';

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
    // v231: all=1이면 from 이후 공고를 전부(입주 물량 그래프용). 아니면 예전처럼 최근 50건.
    if (searchParams.get('all') === '1') {
      const { rows, total, truncated } = await fetchAptSubscriptionsAll(serviceKey, sido, from);
      return Response.json({ rows, total, truncated });
    }
    const rows = await fetchAptSubscriptions(serviceKey, sido, from);
    return Response.json({ rows });
  } catch (e) {
    return Response.json({ error: publicError(e, '청약 정보를 불러오지 못했습니다.') }, { status: 500 });
  }
}

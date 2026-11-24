import { kvReady, kvGet } from '../../../lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// v250: 저장된 수도권 일일 신고 리포트 읽기(누구나). ?date=YYYYMMDD 없으면 가장 최근 것. 날짜 목록(index)도 같이 준다.
export async function GET(request) {
  if (!kvReady()) return Response.json({ index: [], report: null, error: '저장소가 연결되지 않았어요.' });
  const { searchParams } = new URL(request.url);
  const index = (await kvGet('daily:index')) || [];
  const want = String(searchParams.get('date') || '').trim();
  const date = /^\d{8}$/.test(want) && index.includes(want) ? want : index[0];
  const report = date ? await kvGet(`daily:report:${date}`) : null;
  // v257: 날짜별 추이 요약(크론이 daily:stats에 쌓는다)
  let stats = [];
  try { stats = (await kvGet('daily:stats')) || []; } catch (e) { stats = []; }
  // v259: 마지막 아침 작업이 어디까지 갔는지(단계·걸린 시간만)
  let lastrun = null;
  try { lastrun = (await kvGet('daily:lastrun')) || null; } catch (e) { lastrun = null; }
  return Response.json({ index, report, stats, lastrun }, { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300' } });
}

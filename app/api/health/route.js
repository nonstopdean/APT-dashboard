import { buildHealth } from '../../../lib/health';
import { APP_BUILD } from '../../../lib/ui-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// 배포 상태 점검. 환경변수는 설정 여부(true/false)만, 저장소는 연결 여부와 좌표 개수만 돌려준다.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const maxPages = Math.min(Math.max(parseInt(searchParams.get('maxPages') || '30', 10) || 30, 1), 100);
  const body = await buildHealth({ build: APP_BUILD, maxPages });
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}

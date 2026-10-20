import { buildHealth } from '../../../lib/health';
import { APP_BUILD } from '../../../lib/ui-helpers';
import { adminCheck } from '../../../lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// 배포 상태 점검. 환경변수는 설정 여부(true/false)만, 저장소는 연결 여부와 좌표 개수만 돌려준다.
// v220: 빌드 번호는 누구나 볼 수 있고, 환경변수·저장소 상태(저장소를 훑는 비용도 든다)는 관리자만 본다.
export async function GET(request) {
  const auth = adminCheck(request);
  if (!auth.ok) {
    return Response.json({ build: APP_BUILD, checkedAt: new Date().toISOString(), locked: true, lockReason: auth.error }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const { searchParams } = new URL(request.url);
  const maxPages = Math.min(Math.max(parseInt(searchParams.get('maxPages') || '30', 10) || 30, 1), 100);
  const body = await buildHealth({ build: APP_BUILD, maxPages });
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}

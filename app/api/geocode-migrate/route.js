import { kvReady } from '../../../lib/kv';
import { migrateLegacyPage } from '../../../lib/geocode-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// 옛 형식으로 저장된 단지 좌표(geo:)를 새 형식(geoi:)으로 복사한다. 한 번 부를 때 한 페이지만 처리하고
// 다음 cursor를 돌려주니, cursor가 '0'이 될 때까지 계속 부르면 된다(관리자 페이지가 그렇게 한다).
// 여러 번 돌려도 안전하다: 이미 있는 새 값은 덮어쓰지 않고, 옛 값은 지우지 않는다.
export async function GET(request) {
  if (!kvReady()) return Response.json({ error: 'Vercel KV(저장소)가 설정되어 있지 않습니다.' }, { status: 500 });
  const { searchParams } = new URL(request.url);
  const cursor = (searchParams.get('cursor') || '0').trim() || '0';
  const count = Math.min(Math.max(parseInt(searchParams.get('count') || '500', 10) || 500, 10), 1000);
  try {
    const result = await migrateLegacyPage(cursor, count);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: `변환 실패: ${e.message}` }, { status: 500 });
  }
}

import { kvReady } from '../../../lib/kv';
import { readCoords, writeCoords, isValidCoord } from '../../../lib/geocode-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

// 조회·저장 모두 lib/geocode-store.js를 거친다 — 단지 이름 표기가 조금 달라도(띄어쓰기, "아파트" 유무 등)
// 같은 단지로 찾고, 새로 저장하는 값은 정규화한 키로 저장된다.

export async function GET(request) {
  if (!kvReady()) return Response.json({ data: {} });
  const { searchParams } = new URL(request.url);
  const keys = (searchParams.get('keys') || '').split(',').map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) return Response.json({ data: {} });
  try {
    const { data, stats } = await readCoords(keys.slice(0, 2000));
    return Response.json({ data, stats });
  } catch (e) {
    // 서버 캐시 조회가 실패해도 지도 자체는 계속 동작해야 하므로 빈 결과로 넘어간다.
    return Response.json({ data: {} });
  }
}

export async function POST(request) {
  if (!kvReady()) return Response.json({ ok: false, data: {} });
  const body = await request.json();

  // 조회(keys)와 저장(entries)을 같은 라우트의 POST에서 body 모양으로 구분한다.
  // 단지가 많아지면 GET 쿼리스트링은 414(URI Too Long)로 거부될 수 있어서,
  // 조회도 반드시 POST 바디로 보낸다 — 이게 확대 시 "한참 걸리는" 원인이었다.
  if (Array.isArray(body?.keys)) {
    const keys = body.keys.filter(Boolean).slice(0, 2000);
    if (keys.length === 0) return Response.json({ data: {} });
    try {
      const { data, stats } = await readCoords(keys);
      return Response.json({ data, stats });
    } catch (e) {
      return Response.json({ data: {} });
    }
  }

  const entries = Array.isArray(body?.entries) ? body.entries : [];
  // 한반도 밖이거나 숫자가 아닌 값은 저장하지 않는다 (공유 캐시가 오염되지 않게).
  const valid = entries.slice(0, 300).filter((e) => e?.key && isValidCoord(e));
  try {
    await writeCoords(valid);
  } catch (e) {
    // 저장 실패해도 다음 요청 때 다시 시도하면 되므로 조용히 넘어간다.
  }
  return Response.json({ ok: true });
}

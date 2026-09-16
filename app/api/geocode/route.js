import { kvReady, kvGet, kvSet } from '../../../lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const PREFIX = 'geo:';

export async function GET(request) {
  if (!kvReady()) return Response.json({ data: {} });
  const { searchParams } = new URL(request.url);
  const keys = (searchParams.get('keys') || '').split(',').map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) return Response.json({ data: {} });

  const data = {};
  await Promise.all(keys.map(async (key) => {
    try {
      const coord = await kvGet(PREFIX + key);
      if (coord) data[key] = coord;
    } catch (e) {
      // 조회 실패는 조용히 넘어간다 — 클라이언트가 다시 검색하면 그만이다.
    }
  }));
  return Response.json({ data });
}

export async function POST(request) {
  if (!kvReady()) return Response.json({ ok: false });
  const body = await request.json();
  const entries = Array.isArray(body?.entries) ? body.entries : [];
  await Promise.all(entries.slice(0, 300).map(async (e) => {
    if (!e?.key || e.lat == null || e.lng == null) return;
    try {
      await kvSet(PREFIX + e.key, { lat: e.lat, lng: e.lng });
    } catch (err) {
      // 저장 실패해도 다음 요청 때 다시 시도하면 되므로 조용히 넘어간다.
    }
  }));
  return Response.json({ ok: true });
}

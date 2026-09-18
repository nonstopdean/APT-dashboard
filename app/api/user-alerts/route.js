import { kvReady, kvGet, kvSet } from '../../../lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const KEY = 'user-alerts-list';

export async function GET() {
  if (!kvReady()) return Response.json({ alerts: [] });
  try {
    const list = (await kvGet(KEY)) || [];
    return Response.json({ alerts: list });
  } catch (e) {
    return Response.json({ alerts: [] });
  }
}

export async function POST(request) {
  if (!kvReady()) return Response.json({ error: 'Vercel KV가 설정되어 있지 않습니다.' }, { status: 500 });
  const body = await request.json();
  const { apt, dong, regionCode, regionName, targetPrice, direction } = body || {};
  if (!apt || !dong || !regionCode || !targetPrice || !direction) {
    return Response.json({ error: '필수 항목이 빠졌습니다.' }, { status: 400 });
  }
  try {
    const list = (await kvGet(KEY)) || [];
    const alert = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      apt, dong, regionCode, regionName,
      targetPrice: Number(targetPrice), direction, // 'above' | 'below'
      createdAt: new Date().toISOString(),
      firedAt: null,
    };
    list.push(alert);
    await kvSet(KEY, list);
    return Response.json({ ok: true, alert });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  if (!kvReady()) return Response.json({ error: 'Vercel KV가 설정되어 있지 않습니다.' }, { status: 500 });
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return Response.json({ error: 'id가 필요합니다.' }, { status: 400 });
  try {
    const list = (await kvGet(KEY)) || [];
    const next = list.filter((a) => a.id !== id);
    await kvSet(KEY, next);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

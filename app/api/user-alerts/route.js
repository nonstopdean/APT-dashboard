import { publicError } from '../../../lib/safe-error';
import { kvReady, kvGet, kvSet } from '../../../lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const KEY = 'user-alerts-list';
// v255: 알림이 실제로 디스코드로 가게 된 뒤(v254) 누구나 무한히 등록하지 못하게 값 검사와 개수 제한을 둔다.
// 대기 중 알림이 너무 많으면 매일 크론이 국토부를 그만큼 불러 60초를 넘길 수 있다.
const MAX_PENDING = 30;
const MAX_TOTAL = 100; // 보낸 알림 기록까지 합친 저장 개수(넘으면 오래된 보낸 기록부터 지운다)

const cleanText = (v, max) => {
  if (typeof v !== 'string') return '';
  // 제어문자·디스코드 서식 문자(@ ` * _ ~ | < >)는 빼서 알림 메시지에 섞이지 않게 한다
  return v.replace(/[\u0000-\u001f\u007f@`*_~|<>]/g, '').trim().slice(0, max);
};

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
  let body;
  try { body = await request.json(); } catch (e) { body = null; }
  const apt = cleanText(body?.apt, 60);
  const dong = cleanText(body?.dong, 30);
  const regionName = cleanText(body?.regionName, 40);
  const regionCode = String(body?.regionCode ?? '').trim();
  const direction = body?.direction;
  const targetPrice = Number(body?.targetPrice);
  if (!apt || !dong || !/^\d{5}$/.test(regionCode) || !['above', 'below'].includes(direction)) {
    return Response.json({ error: '필수 항목이 빠졌거나 형식이 맞지 않아요.' }, { status: 400 });
  }
  if (!Number.isFinite(targetPrice) || targetPrice < 1000 || targetPrice > 10000000) {
    return Response.json({ error: '목표가는 0.1억 ~ 1,000억 사이로 넣어주세요.' }, { status: 400 });
  }
  try {
    let list = (await kvGet(KEY)) || [];
    const pending = list.filter((a) => !a.firedAt);
    const dup = pending.find((a) => a.apt === apt && a.dong === dong && a.regionCode === regionCode
      && a.direction === direction && a.targetPrice === Math.round(targetPrice));
    if (dup) return Response.json({ ok: true, alert: dup, duplicate: true });
    if (pending.length >= MAX_PENDING) {
      return Response.json({ error: `대기 중인 알림이 ${MAX_PENDING}개라 더 등록할 수 없어요. 필요 없는 알림을 지운 뒤 다시 시도해주세요.` }, { status: 429 });
    }
    const alert = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      apt, dong, regionCode, regionName,
      targetPrice: Math.round(targetPrice), direction, // 'above' | 'below'
      createdAt: new Date().toISOString(),
      firedAt: null,
    };
    list.push(alert);
    if (list.length > MAX_TOTAL) {
      // 보낸 알림 기록 중 오래된 것부터 지운다(대기 중 알림은 지우지 않음)
      const fired = list.filter((a) => a.firedAt).sort((a, b) => String(a.firedAt).localeCompare(String(b.firedAt)));
      const drop = new Set(fired.slice(0, list.length - MAX_TOTAL).map((a) => a.id));
      list = list.filter((a) => !drop.has(a.id));
    }
    await kvSet(KEY, list);
    return Response.json({ ok: true, alert });
  } catch (e) {
    return Response.json({ error: publicError(e, '알림 저장소 처리 중 오류가 발생했습니다.') }, { status: 500 });
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
    return Response.json({ error: publicError(e, '알림 저장소 처리 중 오류가 발생했습니다.') }, { status: 500 });
  }
}

import { timingSafeEqual } from 'crypto';

// 관리자 기능(좌표 예열·좌표 변환·상태 점검 상세) 잠금. Vercel 환경변수 ADMIN_TOKEN과 같은 값을
// 요청 헤더 x-admin-token으로 보낸 경우에만 통과시킨다. 주소(쿼리)로 받지 않는다 — 접속 기록에 남기 때문.
// ADMIN_TOKEN이 없으면 아예 잠근다(설정을 잊었을 때 누구나 쓸 수 있게 열리지 않도록).
export const ADMIN_HEADER = 'x-admin-token';

export function adminCheck(request, env = process.env) {
  const want = String(env.ADMIN_TOKEN || '').trim();
  if (!want) return { ok: false, status: 503, error: 'ADMIN_TOKEN 환경변수가 없어 관리자 기능이 잠겨 있습니다.' };
  const got = String((request.headers && request.headers.get(ADMIN_HEADER)) || '').trim();
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  // 길이가 다르면 timingSafeEqual이 예외를 던지므로 먼저 거른다. 응답에는 어느 쪽이 틀렸는지도 넣지 않는다.
  if (!got || a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, status: 401, error: '관리자 비밀 값이 맞지 않습니다.' };
  return { ok: true };
}

// 막아야 하면 응답을, 통과면 null을 돌려준다. 라우트 맨 앞에서 `const denied = adminDenied(request); if (denied) return denied;`
export function adminDenied(request) {
  const r = adminCheck(request);
  if (r.ok) return null;
  return Response.json({ error: r.error, locked: true }, { status: r.status, headers: { 'Cache-Control': 'no-store' } });
}

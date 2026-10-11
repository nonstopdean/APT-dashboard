// API 응답에 내보내도 되는 오류 문장만 통과시킨다(CLAUDE.md 규칙 6).
// 예외 원문에는 요청 주소(국토부 등은 서비스키가 쿼리에 들어 있다)나 내부 호스트·경로가 섞일 수 있다.
// 통과: 우리가 직접 만든 한국어 문장, 공공 API의 대문자 오류 코드(SERVICE_KEY_IS_NOT_REGISTERED_ERROR 등).
// 그 밖(영문 런타임 오류, 주소·키처럼 보이는 것, 너무 긴 것)은 fallback으로 바꾸고 원문은 서버 로그에만 남긴다.
const UNSAFE = /https?:|\/\/|www\.|[?&=@{}<>\\]|token|secret|password|ECONN|ENOTFOUND|EAI_AGAIN|\.js\b|[A-Za-z0-9+]{24,}/i;
const UPPER_CODE = /^[A-Z0-9_ .]{3,80}$/;

export function publicError(e, fallback = '처리 중 오류가 발생했습니다.') {
  const raw = typeof e === 'string' ? e : (e && typeof e.message === 'string' ? e.message : '');
  const s = raw.trim();
  if (s && s.length <= 120 && !UNSAFE.test(s) && (UPPER_CODE.test(s) || /[가-힣]/.test(s))) return s;
  if (s) console.error('[api error]', s);
  return fallback;
}

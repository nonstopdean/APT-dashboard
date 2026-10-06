import { kvMGet, kvScan, kvReady } from './kv';
import { LEGACY_PREFIX, IDENT_PREFIX } from './geocode-store';

// 배포 상태 점검(/api/health, /admin/health)의 계산. 매번 스크린샷을 주고받지 않아도
// "어떤 키가 설정됐는지 / 저장소가 붙는지 / 저장된 좌표가 몇 개인지"를 한 번에 볼 수 있게 한다.
//
// 보안: 환경변수는 "설정됨/안 됨"만 돌려주고 값은 절대 포함하지 않는다. 오류 메시지도 값이 섞이지 않게 짧게 자른다.
export const ENV_CHECKS = [
  ['MOLIT_SERVICE_KEY', '국토부 실거래 API', true],
  ['KAKAO_REST_API_KEY', '카카오 REST(예열용 좌표 검색)', true],
  ['NEXT_PUBLIC_KAKAO_MAP_KEY', '카카오 JS(브라우저 좌표 검색)', true],
  ['NEXT_PUBLIC_NAVER_MAP_KEY_ID', '네이버 지도', true],
  ['KV_REST_API_URL', '저장소(Upstash) 주소', true],
  ['KV_REST_API_TOKEN', '저장소(Upstash) 토큰', true],
  ['KOSIS_API_KEY', '인구·이동 통계', false],
  ['RONE_SERVICE_KEY', '한국부동산원 시세', false],
  ['SCHOOL_LOCATION_API_KEY', '학교 위치', false],
  ['NEIS_API_KEY', '학교 정보(NEIS)', false],
  ['VWORLD_API_KEY', '브이월드(공시가격 등)', false],
];

export function summarizeEnv(env) {
  return ENV_CHECKS.map(([name, label, required]) => ({
    name, label, required, set: typeof env[name] === 'string' && env[name].trim().length > 0, // 값은 담지 않는다
  }));
}

// 키를 SCAN으로 훑어 개수만 센다. 한 번에 1000개씩 최대 maxPages번 — 너무 많으면 truncated=true(최소 이만큼).
export async function countKeys(prefix, { maxPages = 30, count = 1000 } = {}) {
  let cursor = '0';
  let total = 0;
  let pages = 0;
  do {
    // eslint-disable-next-line no-await-in-loop
    const [next, keys] = await kvScan(cursor, `${prefix}*`, count);
    total += keys.length;
    cursor = next;
    pages += 1;
  } while (cursor !== '0' && pages < maxPages);
  return { count: total, truncated: cursor !== '0' };
}

// 오류 원문은 응답에 넣지 않는다. 네트워크 오류 메시지에는 요청 주소나 토큰 같은 값이 섞여 나올 수 있어서,
// "자르기"로는 가려지지 않는다. 대신 원인을 몇 가지로 분류한 고정 문구만 돌려준다.
export function safeErrorLabel(e) {
  const msg = String((e && (e.message || e.code)) || e || '').toLowerCase();
  // 구체적인 것부터 판정한다. "token"이라는 단어만으로 인증 오류로 보면 "Unexpected token < in JSON"(형식 오류)이나
  // 이름에 TOKEN이 들어간 아무 오류까지 인증 실패로 잘못 안내하게 된다.
  if (/unexpected token|unexpected end of json|json|scan 응답/.test(msg)) return '저장소가 예상과 다른 응답을 줬어요';
  if (/econnrefused|enotfound|eai_again|fetch failed|network|socket|timed? ?out|etimedout|econnreset/.test(msg)) return '저장소에 연결할 수 없어요(주소가 틀렸거나 네트워크 문제일 수 있어요)';
  if (/\b(401|403)\b|unauthorized|forbidden|noauth|wrongpass|invalid (api )?token|permission/.test(msg)) return '저장소 인증에 실패했어요(토큰을 확인해주세요)';
  if (/\b429\b|rate limit|too many requests|quota/.test(msg)) return '저장소 사용량 한도에 걸렸어요';
  return '저장소 점검 중 알 수 없는 오류가 났어요';
}
const shortError = safeErrorLabel;

export async function buildHealth({ env = process.env, build, maxPages = 30, now = Date.now } = {}) {
  const out = { build, checkedAt: new Date(now()).toISOString(), env: summarizeEnv(env), kv: { configured: false } };
  if (!kvReady()) return out;
  out.kv.configured = true;
  const t0 = now();
  try {
    await kvMGet(['health:ping']);
    out.kv.ok = true;
    out.kv.latencyMs = now() - t0;
  } catch (e) {
    out.kv.ok = false;
    out.kv.error = shortError(e);
    return out;
  }
  try {
    const [legacy, ident] = await Promise.all([
      countKeys(LEGACY_PREFIX, { maxPages }),
      countKeys(IDENT_PREFIX, { maxPages }),
    ]);
    out.geocode = { legacy, identity: ident };
    // 옛 키만 있고 새 키가 하나도 없으면 "기존 좌표 변환"을 아직 안 한 것이다.
    out.geocode.needsMigration = legacy.count > 0 && ident.count === 0;
  } catch (e) {
    out.geocode = { error: shortError(e) };
  }
  return out;
}

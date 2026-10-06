import { REGION_GROUPS } from './regions';

// 카카오 키워드 검색 결과에서 "그 단지가 맞는 장소"를 고르는 규칙과, 단지 마커 좌표의 우선순위를
// 한곳에 모은 순수 함수들. 브라우저(지도)와 서버(예열) 양쪽이 같은 규칙을 쓴다.
//
// 왜 필요한가: 예전에는 검색 결과 첫 번째를 지역 확인 없이 그대로 썼다. "래미안"처럼 흔한 이름은
// 다른 도시의 결과가 첫 번째로 올 수 있고, 그 좌표가 모든 방문자가 공유하는 서버 캐시에 저장됐다.

const SIDO_SHORT = {
  서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주',
  대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종', 경기도: '경기', 강원특별자치도: '강원',
  충청북도: '충북', 충청남도: '충남', 전북특별자치도: '전북', 전라남도: '전남', 경상북도: '경북',
  경상남도: '경남', 제주특별자치도: '제주',
};

const PLACE_BY_CODE = new Map();
REGION_GROUPS.forEach((g) => g.items.forEach((it) => {
  PLACE_BY_CODE.set(it.code, {
    sidoShort: SIDO_SHORT[g.sido] || null,
    name: it.name,
    // "수원시 영통구" → "영통구". 같은 이름의 구가 다른 시·도에 있어도 시·도 검사가 따로 걸러준다.
    key: it.name.split(/\s+/).pop(),
  });
}));

// 지역코드 → 주소 검증에 쓸 정보. 모르는 코드면 null (이때는 검증할 수 없으니 좌표를 채택하지 않는다).
export function placeContextOf(regionCode) {
  return PLACE_BY_CODE.get(regionCode) || null;
}

const compact = (s) => String(s || '').toLowerCase().replace(/[\s\-_.()·,]/g, '');

// docs: 카카오 키워드 검색 결과(place_name, category_name, address_name, road_address_name, x, y).
// ctx: { place: placeContextOf(...), dong, aptName }
// 시·도와 시군구가 주소에 모두 맞는 결과만 후보로 삼고, 그중 "아파트" 분류·같은 동·비슷한 이름을 우선한다.
// 후보가 하나도 없으면 null — 틀린 곳에 찍느니 못 찾았다고 하는 편이 낫다.
export function pickPlace(docs, ctx) {
  if (!Array.isArray(docs) || docs.length === 0 || !ctx?.place) return null;
  const { sidoShort, key } = ctx.place;
  const an = compact(ctx.aptName);
  let best = null;
  let bestScore = -1;
  docs.forEach((d) => {
    const jibun = String(d?.address_name || '');
    const road = String(d?.road_address_name || '');
    const lat = parseFloat(d?.y);
    const lng = parseFloat(d?.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const sidoOk = !sidoShort || jibun.startsWith(sidoShort) || road.startsWith(sidoShort);
    const sigunguOk = `${jibun} ${road}`.includes(key);
    if (!sidoOk || !sigunguOk) return;
    let score = 0;
    if (String(d.category_name || '').includes('아파트')) score += 4;
    if (ctx.dong && jibun.includes(ctx.dong)) score += 2;
    const nm = compact(d.place_name);
    if (an.length >= 2 && nm && (nm.includes(an) || an.includes(nm))) score += 1;
    if (score > bestScore) { bestScore = score; best = { lat, lng }; } // 동점이면 카카오가 준 앞 순서 유지
  });
  return best;
}

export function distanceKm(a, b) {
  const R = 6371;
  const rad = (v) => (v * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 정확한 좌표가 같은 동의 중심점에서 너무 멀면(다른 도시로 잘못 저장된 값 등) 믿지 않는다.
export function isPlausibleCoord(coord, anchor, maxKm = 8) {
  if (!coord || !Number.isFinite(coord.lat) || !Number.isFinite(coord.lng)) return false;
  if (!anchor) return true; // 비교할 기준이 없으면 막지 않는다
  return distanceKm(coord, anchor) <= maxKm;
}

// 마커를 어디에 찍을지: 정확한 좌표(카카오·서버 캐시) > 동 중심점(근사) > 아직 모름/못 찾음.
// 예전에는 동 중심점이 있으면 정확한 좌표를 아예 쓰지 않아서, 예열해둔 좌표가 버려졌다.
//   approx: 동 중심점 {lat,lng} | null
//   exact : 캐시 항목 {lat,lng} | null(검색해봤지만 실패) | undefined(아직 검색 안 함)
export function resolveMarkerCoord(approx, exact, maxKm = 8) {
  if (exact && isPlausibleCoord(exact, approx, maxKm)) return { coord: exact, source: 'exact' };
  if (approx) return { coord: approx, source: 'approx' };
  if (exact === null) return { coord: null, source: 'failed' };
  if (exact) return { coord: null, source: 'failed' }; // 좌표값 자체가 깨진 항목(숫자가 아님)이면 못 찾은 것으로 본다
  return { coord: undefined, source: 'unknown' };
}

// 화면 카드에 보여줄 통계: 지금 단지들의 좌표가 어디서 왔는지.
export function summarizeCoordSources(complexes, cache, maxKm = 8) {
  const out = { total: 0, exact: 0, approx: 0, failed: 0, pending: 0 };
  (complexes || []).forEach((c) => {
    out.total += 1;
    const approx = c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : null;
    const { source } = resolveMarkerCoord(approx, cache?.[c.key], maxKm);
    if (source === 'exact') out.exact += 1;
    else if (source === 'approx') out.approx += 1;
    else if (source === 'failed') out.failed += 1;
    else out.pending += 1;
  });
  return out;
}

// 시·도별 대략적인 위경도 범위 [남, 북, 서, 동]. 일부러 넉넉하게(약 0.1° 여유) 잡은 사각형이라 "다른 시·도의 좌표"만 걸러낸다.
// 같은 시·도 안에서 구가 틀린 경우는 못 거르고, **서로 맞닿은 시·도의 사각형이 겹치는 곳**(예: 충북 서부와 충남)도 못 거른다
// (구가 틀린 경우는 브라우저가 동 중심점과 비교해서 거른다). 이 표가 잡는 건 "서울 단지에 부산 좌표" 같은 멀리 떨어진 오류다. 정확한 행정경계가 아니라
// 도시청사와 섬(울릉·독도·백령·가거도·마라도 등)으로 확인한 근사치다.
export const SIDO_BOX = {
  서울: [37.40, 37.74, 126.68, 127.20],
  부산: [34.85, 35.42, 128.72, 129.33],
  대구: [35.50, 36.30, 128.25, 129.05],
  인천: [36.95, 38.02, 124.50, 126.90],
  광주: [35.03, 35.32, 126.60, 127.08],
  대전: [36.12, 36.52, 127.22, 127.58],
  울산: [35.32, 35.78, 128.95, 129.52],
  세종: [36.38, 36.78, 126.95, 127.45],
  경기: [36.85, 38.35, 126.30, 127.98],
  강원: [36.95, 38.65, 127.00, 129.45],
  충북: [35.95, 37.25, 127.20, 128.55],
  충남: [35.95, 37.20, 125.40, 127.75],
  전북: [35.00, 36.25, 126.30, 128.00],
  전남: [33.85, 35.55, 125.00, 127.95],
  경북: [35.55, 37.65, 127.75, 131.95], // 서쪽은 김천·상주·문경(약 127.8°E), 동쪽은 독도(131.87°E)까지 포함
  경남: [34.50, 35.95, 127.55, 129.45],
  제주: [33.05, 33.62, 126.10, 127.00],
};

export function isCoordInSido(sidoShort, coord) {
  const b = SIDO_BOX[sidoShort];
  if (!b || !coord) return true; // 모르는 시·도면 판단하지 않는다(거르지 않는다)
  return coord.lat >= b[0] && coord.lat <= b[1] && coord.lng >= b[2] && coord.lng <= b[3];
}

// 단지 키의 지역코드가 속한 시·도 범위 안의 좌표인가. 지역코드를 모르면 true(판단 불가).
export function plausibleForRegion(regionCode, coord) {
  const place = placeContextOf(regionCode);
  return place && place.sidoShort ? isCoordInSido(place.sidoShort, coord) : true;
}

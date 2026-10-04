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

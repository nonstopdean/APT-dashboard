import { REGION_GROUPS, SIDO_AGGREGATES } from './regions';

// v232: 지도 단계별 말풍선(아실처럼) — 멀리서는 시·도, 조금 확대하면 시·군·구, 더 확대하면 동, 더 확대하면 단지 핀.
// 시·도·시군구 값은 한국부동산원 (월) 아파트 평균매매가격(/api/region-prices, 만원), 동 값은 불러온 실거래의 평균 평당가.
// 말풍선 항목: { key, name, lat, lng, value, change(전월 대비 %, 없으면 null), kind: 'price' | 'pyeong', n? }

const SHORT = {
  서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주',
  대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종', 경기도: '경기', 강원특별자치도: '강원',
  충청북도: '충북', 충청남도: '충남', 전북특별자치도: '전북', 전라남도: '전남', 경상북도: '경북',
  경상남도: '경남', 제주특별자치도: '제주',
};

const changeOf = (it) => (it && it.prev ? ((it.v - it.prev) / it.prev) * 100 : null);

// prices: { [지역코드]: { v, prev } }, centerOf: 지역코드 → {lat,lng} (구 중심점). 시·도 중심 = 그 안 구 중심들의 평균.
export function sidoBubbles(prices, centerOf) {
  if (!prices) return [];
  const out = [];
  REGION_GROUPS.forEach((g) => {
    const agg = SIDO_AGGREGATES.find((a) => a.sido === g.sido);
    // 세종처럼 시·도 전체 코드가 없고 지역이 하나뿐이면 그 지역 값.
    const it = (agg && prices[agg.code]) || (g.items.length === 1 ? prices[g.items[0].code] : null);
    if (!it) return;
    const pts = g.items.map((i) => centerOf[i.code]).filter(Boolean);
    if (!pts.length) return;
    const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
    out.push({ key: `s${agg ? agg.code : g.items[0].code}`, name: SHORT[g.sido] || g.sido, lat, lng, value: it.v, change: changeOf(it), kind: 'price' });
  });
  return out;
}

// features: 지도 구 경계 [{ name, codes }] — 한 경계에 코드가 여럿이면 값이 있는 첫 코드.
export function sggBubbles(features, prices, centerOf) {
  if (!prices || !features) return [];
  const out = [];
  const seen = new Set();
  features.forEach((f) => {
    const codes = f.codes || (f.code ? [f.code] : []);
    const code = codes.find((c) => prices[c]);
    if (!code || seen.has(code)) return;
    const c = centerOf[codes[0]] || centerOf[code];
    if (!c) return;
    seen.add(code);
    out.push({ key: `g${code}`, code, name: f.name, lat: c.lat, lng: c.lng, value: prices[code].v, change: changeOf(prices[code]), kind: 'price' });
  });
  return out;
}

// txs: 실거래(고른 지역 + 주변 구), centroidOf(regionCode, dong) → {lat,lng}|null. 매매는 평당가, 전월세는 전세 보증금 평당가.
// 거래 minN건 미만인 동은 뺀다(한두 건으로 동 평균을 말하면 튄다).
export function dongBubbles(txs, centroidOf, isRent, minN = 3) {
  const groups = new Map();
  (txs || []).forEach((t) => {
    const v = isRent ? (t.isJeonse ? t.depositPerPyeong : null) : t.pricePerPyeong;
    if (!Number.isFinite(v) || !t.dong || !t.regionCode) return;
    const k = `${t.regionCode}|${t.dong}`;
    if (!groups.has(k)) groups.set(k, { regionCode: t.regionCode, dong: t.dong, sum: 0, n: 0 });
    const g = groups.get(k);
    g.sum += v; g.n += 1;
  });
  const out = [];
  groups.forEach((g, k) => {
    if (g.n < minN) return;
    const c = centroidOf(g.regionCode, g.dong);
    if (!c) return;
    out.push({ key: `d${k}`, name: g.dong, lat: c.lat, lng: c.lng, value: Math.round(g.sum / g.n), change: null, kind: 'pyeong', n: g.n });
  });
  return out;
}

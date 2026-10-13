import { supplyPyeong } from './pyeong';

// 같은 평형 주변 시세 비교(v197, 단지 상세 "주변 34평 시세").
// 조회 기간 거래 중 공급 minPy~maxPy평(기본 33~35평 = 전용 약 84㎡)만 골라 단지별 중간값을 내고,
// 지금 단지에서 radius(m) 안의 단지끼리 비싼 순으로 줄 세운다. 한 건짜리 이상 거래에 덜 흔들리게 평균 대신 중간값.
//   txs: 실거래 행(regionCode·dong·apt·area 포함), priceOf: 행 → 가격(만원) 또는 null
//   coordOf: 단지 키 → {lat,lng} | null, distanceOf: (a, b) → 미터
export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function peerPriceCompare({ txs, selfKey, coordOf, distanceOf, radius, priceOf, minPy = 33, maxPy = 35 }) {
  const selfCoord = coordOf(selfKey);
  if (!selfCoord) return null;
  const groups = new Map();
  (txs || []).forEach((t) => {
    const sp = supplyPyeong(t.area);
    if (sp == null || sp < minPy || sp > maxPy) return;
    const p = priceOf(t);
    if (!Number.isFinite(p) || p <= 0) return;
    const key = `${t.regionCode}|${t.dong}|${t.apt}`;
    if (!groups.has(key)) groups.set(key, { key, apt: t.apt, dong: t.dong, regionCode: t.regionCode, prices: [] });
    groups.get(key).prices.push(p);
  });
  const rows = [];
  groups.forEach((g) => {
    const isSelf = g.key === selfKey;
    let distance = 0;
    if (!isSelf) {
      const c = coordOf(g.key);
      if (!c) return;
      distance = distanceOf(selfCoord, c);
      if (!(distance <= radius)) return;
    }
    rows.push({ key: g.key, apt: g.apt, dong: g.dong, regionCode: g.regionCode, median: median(g.prices), n: g.prices.length, distance, self: isSelf });
  });
  rows.sort((a, b) => b.median - a.median);
  const self = rows.find((r) => r.self) || null;
  const others = rows.filter((r) => !r.self);
  const peerMedian = others.length ? median(others.map((r) => r.median)) : null;
  return {
    rows,
    self,
    peerCount: others.length,
    peerMedian,
    rank: self ? rows.indexOf(self) + 1 : null,
    diffPct: self && peerMedian ? (self.median / peerMedian - 1) * 100 : null,
  };
}

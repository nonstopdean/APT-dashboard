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

// 한 단지의 같은 평형(기본 34평) 매매·전세 중간값과 갭(v198, 비교함 표). 월세·0원은 뺀다.
export function pyeongMedians(saleRows, rentRows, minPy = 33, maxPy = 35) {
  const inRange = (r) => { const sp = supplyPyeong(r.area); return sp != null && sp >= minPy && sp <= maxPy; };
  const sale = (saleRows || []).filter(inRange).map((r) => Number(r.amount)).filter((v) => Number.isFinite(v) && v > 0);
  const jeonse = (rentRows || []).filter((r) => r.isJeonse && inRange(r)).map((r) => Number(r.deposit)).filter((v) => Number.isFinite(v) && v > 0);
  const s = median(sale);
  const j = median(jeonse);
  return { sale: s, nSale: sale.length, jeonse: j, nJeonse: jeonse.length, gap: s != null && j != null ? s - j : null };
}

// 단지 상세 "34평 갭 추이"(v202): months(오름차순 'YYYYMM') 각 달에 대해 그 달 포함 최근 win개월 거래로 pyeongMedians를 낸다.
// 한 달 거래만으로는 점이 드물어서 이동 구간을 쓴다. 매매·전세 중 하나라도 없으면 gap은 null.
export function gapSeries(saleRows, rentRows, months, win = 3) {
  const ymOf = (r) => `${r.year}${String(r.month).padStart(2, '0')}`;
  return (months || []).map((ym, i) => {
    const span = new Set(months.slice(Math.max(0, i - win + 1), i + 1));
    const p = pyeongMedians((saleRows || []).filter((r) => span.has(ymOf(r))), (rentRows || []).filter((r) => span.has(ymOf(r))));
    return { ym, ...p };
  });
}

// 지도 "34평 갭" 색칠(v199): keyOf(행)로 구·동별로 묶어 34평 매매 중간값 − 전세 중간값.
// 매매·전세가 각각 minN건 이상인 곳만 값을 낸다(적은 표본으로 색을 칠하면 오해를 부른다).
export function gapIndex(saleRows, rentRows, keyOf, { minN = 2, minPy = 33, maxPy = 35 } = {}) {
  const inRange = (r) => { const sp = supplyPyeong(r.area); return sp != null && sp >= minPy && sp <= maxPy; };
  const groups = new Map();
  const add = (row, field, v) => {
    if (!inRange(row) || !Number.isFinite(v) || v <= 0) return;
    const k = keyOf(row);
    if (k == null) return;
    if (!groups.has(k)) groups.set(k, { sale: [], jeonse: [] });
    groups.get(k)[field].push(v);
  };
  (saleRows || []).forEach((r) => add(r, 'sale', Number(r.amount)));
  (rentRows || []).forEach((r) => { if (r.isJeonse) add(r, 'jeonse', Number(r.deposit)); });
  const out = new Map();
  groups.forEach((g, k) => {
    if (g.sale.length < minN || g.jeonse.length < minN) return;
    const s = median(g.sale);
    const j = median(g.jeonse);
    out.set(k, { gap: s - j, sale: s, jeonse: j, nSale: g.sale.length, nJeonse: g.jeonse.length });
  });
  return out;
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

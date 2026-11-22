import { unitValueOf, priceValueOf } from './market-compare';

// v249: 시장분석 "신고가·주요 거래" 리포트(components/TradeReport.jsx)의 순수 함수들.
// 참고한 블로그(수도권 실거래 일일 리포트)는 "신고일" 기준이지만 국토부 자료엔 계약일만 있어 계약일 기준으로 한다.
// 신고가는 같은 단지·같은 전용면적(㎡ 반올림)에서 "불러온 기간 안" 앞선 거래의 최고가를 넘긴 거래(2006년 이후 전체가 아님).

const DAY = 24 * 3600 * 1000;
export const dayOf = (t) => Date.UTC(Number(t.year), Number(t.month) - 1, Number(t.day) || 1);
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

// 기준일 = 자료에서 가장 늦은 계약일(오늘이 아니라 — 신고가 끝나지 않은 날이 비어 있어 숫자가 줄어 보이지 않게)
export function latestDay(tx) {
  let max = null;
  (tx || []).forEach((t) => { const d = dayOf(t); if (Number.isFinite(d) && (max == null || d > max)) max = d; });
  return max;
}

// 최근 days일(기준일 포함) 거래
export function recentTrades(tx, days, ref = latestDay(tx)) {
  if (ref == null) return [];
  const from = ref - (days - 1) * DAY;
  return (tx || []).filter((t) => { const d = dayOf(t); return d >= from && d <= ref; });
}

// 가격순 주요 거래 — 최근 days일, 가격 높은 순 limit건. 같은 단지는 한 번만(가장 비싼 거래).
export function topTrades(tx, isRent, { days = 30, limit = 20, ref } = {}) {
  const seen = new Set();
  return recentTrades(tx, days, ref)
    .filter((t) => priceValueOf(t, isRent) != null)
    .sort((a, b) => priceValueOf(b, isRent) - priceValueOf(a, isRent))
    .filter((t) => { const k = `${t.regionCode}|${t.dong}|${t.apt}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, limit);
}

// 신고가 — 단지·전용면적별로 계약일 순서대로 보며 앞선 최고가를 넘긴 거래를 찾고, 그중 최근 days일 것만 가격순으로.
// 앞선 거래가 없으면(첫 거래) 신고가로 치지 않는다. 같은 날 여러 건이면 앞선 날까지의 최고가와 비교한다.
export function newHighs(tx, isRent, { days = 30, ref } = {}) {
  const r = ref ?? latestDay(tx);
  if (r == null) return [];
  const from = r - (days - 1) * DAY;
  const groups = new Map();
  (tx || []).forEach((t) => {
    if (priceValueOf(t, isRent) == null || !Number.isFinite(Number(t.area))) return;
    const k = `${t.regionCode}|${t.dong}|${t.apt}|${Math.round(Number(t.area))}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  });
  const out = [];
  groups.forEach((list) => {
    list.sort((a, b) => dayOf(a) - dayOf(b));
    let prevMax = null; let prevDay = null;
    let i = 0;
    while (i < list.length) {
      const d = dayOf(list[i]);
      let j = i;
      while (j < list.length && dayOf(list[j]) === d) j += 1;
      const sameDay = list.slice(i, j);
      if (prevMax != null && d >= from && d <= r) {
        sameDay.forEach((t) => { const p = priceValueOf(t, isRent); if (p > prevMax) out.push({ t, prevMax, prevDay, risePct: ((p - prevMax) / prevMax) * 100 }); });
      }
      sameDay.forEach((t) => { const p = priceValueOf(t, isRent); if (prevMax == null || p > prevMax) { prevMax = p; prevDay = d; } });
      i = j;
    }
  });
  return out.sort((a, b) => priceValueOf(b.t, isRent) - priceValueOf(a.t, isRent));
}

// 지역별 평당가 변동 — 최근 days일 vs 그 직전 days일 평균 평당가. 양쪽 minN건 이상인 지역만, 변동률 높은 순.
export function regionUnitChange(tx, isRent, { days = 30, minN = 5, ref } = {}) {
  const r = ref ?? latestDay(tx);
  if (r == null) return [];
  const recentFrom = r - (days - 1) * DAY;
  const prevFrom = recentFrom - days * DAY;
  const by = new Map();
  (tx || []).forEach((t) => {
    const v = unitValueOf(t, isRent);
    if (v == null) return;
    const d = dayOf(t);
    let bucket = null;
    if (d >= recentFrom && d <= r) bucket = 'recent';
    else if (d >= prevFrom && d < recentFrom) bucket = 'prev';
    if (!bucket) return;
    if (!by.has(t.regionCode)) by.set(t.regionCode, { recent: [], prev: [] });
    by.get(t.regionCode)[bucket].push(v);
  });
  const out = [];
  by.forEach((g, code) => {
    if (g.recent.length < minN || g.prev.length < minN) return;
    const a = mean(g.recent); const b = mean(g.prev);
    out.push({ code, recentAvg: a, prevAvg: b, pct: ((a - b) / b) * 100, nRecent: g.recent.length, nPrev: g.prev.length });
  });
  return out.sort((x, y) => y.pct - x.pct);
}

export const fmtDay = (ms) => {
  if (ms == null) return '-';
  const d = new Date(ms);
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`;
};

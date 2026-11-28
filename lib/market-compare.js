import { normalizeComplexName } from './complex-match';

// v247: 시장분석 탭 "단지 비교"·"지역 비교"(components/MarketCompare.jsx)가 쓰는 순수 함수들.
// tx = 분석기간 안 실거래(page.jsx advancedAnalytics.tx), rows = 단지별 요약(advancedAnalytics.rows).

const ymOf = (t) => Number(t.year) * 100 + Number(t.month);
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

export const unitValueOf = (t, isRent) => {
  const v = isRent ? (t.isJeonse ? t.depositPerPyeong : null) : t.pricePerPyeong;
  return Number.isFinite(v) && v > 0 ? v : null;
};
export const priceValueOf = (t, isRent) => {
  const v = isRent ? (t.isJeonse ? t.deposit : null) : t.amount;
  return Number.isFinite(v) && v > 0 ? v : null;
};

// 지역(시·군·구)별 비교표 — 거래 수, 단지 수, 평균 평당가, 중위 거래가, 기간 앞·뒤 절반 평당가 변화, 신고가 단지 수.
// 변화는 앞·뒤 절반에 평당가 표본이 minHalf건 이상일 때만(적으면 null). 평균 평당가 높은 순.
export function regionCompareRows(tx, rows, isRent, { minHalf = 5 } = {}) {
  const by = new Map();
  (tx || []).forEach((t) => {
    if (!t?.regionCode) return;
    if (!by.has(t.regionCode)) by.set(t.regionCode, []);
    by.get(t.regionCode).push(t);
  });
  const highsBy = new Map();
  (rows || []).forEach((r) => { if (r.newHigh) highsBy.set(r.regionCode, (highsBy.get(r.regionCode) || 0) + 1); });
  const out = [];
  by.forEach((list, code) => {
    const units = list.map((t) => unitValueOf(t, isRent)).filter((v) => v != null);
    const prices = list.map((t) => priceValueOf(t, isRent)).filter((v) => v != null);
    const yms = [...new Set(list.map(ymOf))].sort((a, b) => a - b);
    let changePct = null;
    if (yms.length >= 2) {
      const cut = yms[Math.floor(yms.length / 2)];
      const early = list.filter((t) => ymOf(t) < cut).map((t) => unitValueOf(t, isRent)).filter((v) => v != null);
      const late = list.filter((t) => ymOf(t) >= cut).map((t) => unitValueOf(t, isRent)).filter((v) => v != null);
      if (early.length >= minHalf && late.length >= minHalf) changePct = ((mean(late) - mean(early)) / mean(early)) * 100;
    }
    out.push({
      code,
      count: list.length,
      complexes: new Set(list.map((t) => `${t.dong}|${t.apt}`)).size,
      avgUnit: mean(units),
      medianPrice: median(prices),
      changePct,
      highs: highsBy.get(code) || 0,
    });
  });
  return out.sort((a, b) => (b.avgUnit ?? -1) - (a.avgUnit ?? -1));
}

// v248: 단지 비교표 — 평형이 섞여도 왜곡되지 않게 평당가 기준으로.
// 평균 평당가, 앞·뒤 절반 평당가 변화(양쪽 minHalf건 이상), 최고 평당가, 최근 거래(금액·전용면적·날짜), 거래 수.
export function complexCompareStats(tx, key, isRent, { minHalf = 2 } = {}) {
  const list = (tx || []).filter((t) => `${t.regionCode}|${t.dong}|${t.apt}` === key);
  const units = list.map((t) => unitValueOf(t, isRent)).filter((v) => v != null);
  const dated = list.filter((t) => priceValueOf(t, isRent) != null)
    .sort((a, b) => (Number(b.year) * 10000 + Number(b.month) * 100 + Number(b.day || 0)) - (Number(a.year) * 10000 + Number(a.month) * 100 + Number(a.day || 0)));
  const yms = [...new Set(list.map(ymOf))].sort((a, b) => a - b);
  let changePct = null;
  if (yms.length >= 2) {
    const cut = yms[Math.floor(yms.length / 2)];
    const early = list.filter((t) => ymOf(t) < cut).map((t) => unitValueOf(t, isRent)).filter((v) => v != null);
    const late = list.filter((t) => ymOf(t) >= cut).map((t) => unitValueOf(t, isRent)).filter((v) => v != null);
    if (early.length >= minHalf && late.length >= minHalf) changePct = ((mean(late) - mean(early)) / mean(early)) * 100;
  }
  const last = dated[0] || null;
  return {
    count: list.length,
    avgUnit: mean(units),
    maxUnit: units.length ? Math.max(...units) : null,
    changePct,
    latest: last ? { price: priceValueOf(last, isRent), area: last.area, ymd: `${last.year}.${String(last.month).padStart(2, '0')}.${String(last.day || '').padStart(2, '0')}` } : null,
  };
}

// 단지 고르기 — 이름(띄어쓰기·"아파트" 무시)에 검색어가 들어간 단지, 앞부분이 맞는 것·거래 많은 것 먼저. 최대 limit개.
export function searchRows(rows, query, limit = 8) {
  const q = normalizeComplexName(query);
  if (q.length < 1) return [];
  return (rows || [])
    .map((r) => ({ r, i: normalizeComplexName(r.apt).indexOf(q) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => (a.i === 0 ? 0 : 1) - (b.i === 0 ? 0 : 1) || b.r.volume - a.r.volume)
    .slice(0, limit)
    .map((x) => x.r);
}

// v280: 단지 비교 "카테고리로 고르기" — 지역·동·평형대로 거르고 기준(거래 많은·평당가 높은·신고가·상승·고점 대비 하락)으로 줄 세운다.
// rows = advancedAnalytics.rows. sizeOf(area) = 공급 평형(lib/pyeong supplyPyeong)을 밖에서 넘긴다(이 파일을 가볍게).
export const COMPARE_SORTS = [
  { key: 'volume', label: '거래 많은' },
  { key: 'unit', label: '평당가 높은' },
  { key: 'rise', label: '많이 오른' },
  { key: 'high', label: '신고가' },
  { key: 'drop', label: '고점 대비 하락' },
];
export const COMPARE_SIZES = [
  { key: 'all', label: '전체 평형' },
  { key: 's', label: '20평대 이하', test: (p) => p < 30 },
  { key: 'm', label: '30평대', test: (p) => p >= 30 && p < 40 },
  { key: 'l', label: '40평 이상', test: (p) => p >= 40 },
];
export function compareUnitOf(r, isRent, sizeOf) {
  if (!isRent) return Number.isFinite(r.unitPrice) && r.unitPrice > 0 ? r.unitPrice : null;
  const p = sizeOf(r.area);
  return Number.isFinite(r.latest) && p > 0 ? r.latest / p : null;
}
export function categoryRows(rows, { region = 'all', dong = 'all', size = 'all', sort = 'volume', isRent = false, sizeOf, minSame = 3 } = {}) {
  const sizeTest = (COMPARE_SIZES.find((s) => s.key === size) || {}).test;
  let list = (rows || []).filter((r) => (region === 'all' || r.regionCode === region)
    && (dong === 'all' || r.dong === dong)
    && (!sizeTest || sizeTest(sizeOf(r.area))));
  const enough = (r) => (r.sameN || 0) >= minSame;
  const unit = (r) => compareUnitOf(r, isRent, sizeOf) ?? -1;
  if (sort === 'unit') list = list.filter((r) => unit(r) > 0).sort((a, b) => unit(b) - unit(a));
  else if (sort === 'rise') list = list.filter((r) => r.change != null && enough(r)).sort((a, b) => b.change - a.change);
  else if (sort === 'high') list = list.filter((r) => r.newHigh && enough(r)).sort((a, b) => b.volume - a.volume);
  else if (sort === 'drop') list = list.filter((r) => r.drawdown != null && r.drawdown < 0 && enough(r)).sort((a, b) => a.drawdown - b.drawdown);
  else list = [...list].sort((a, b) => b.volume - a.volume);
  return list;
}
// 지역·동 칩 — 단지 수 많은 순
export function categoryGroups(rows, region = 'all') {
  const regions = new Map();
  const dongs = new Map();
  (rows || []).forEach((r) => {
    regions.set(r.regionCode, (regions.get(r.regionCode) || 0) + 1);
    if (region !== 'all' && r.regionCode === region) dongs.set(r.dong, (dongs.get(r.dong) || 0) + 1);
  });
  const sortBy = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, n }));
  return { regions: sortBy(regions), dongs: sortBy(dongs) };
}

// 비교 대상 이름표 — 같은 이름 단지가 여럿이면 동을 붙인다("현대(문정동)").
export function complexLabels(list) {
  const cnt = new Map();
  list.forEach((c) => cnt.set(c.apt, (cnt.get(c.apt) || 0) + 1));
  return list.map((c) => (cnt.get(c.apt) > 1 ? `${c.apt}(${c.dong})` : c.apt));
}

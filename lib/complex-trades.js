import { supplyPyeong } from './pyeong';

// v241: 지도 탭 단지 상세의 "실거래가" 그래프·내역(components/ComplexTradePanel.jsx)이 쓰는 순수 함수들.
// 국토부 실거래 자료에는 동(aptDong, 매매만)과 층(floor)까지만 있고 호수는 공개되지 않는다.

const num = (v) => {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
};

export const dealDateNum = (t) => (num(t.year) || 0) * 10000 + (num(t.month) || 0) * 100 + (num(t.day) || 0);
export const dealTs = (t) => Date.UTC(num(t.year) || 1970, (num(t.month) || 1) - 1, num(t.day) || 15);
export const floorOf = (t) => num(t.floor);

// mode: 'trade'(매매가) | 'jeonse'(전세 보증금) | 'wolse'(월세)
export function priceOfDeal(t, mode) {
  const v = mode === 'trade' ? t.amount : mode === 'jeonse' ? t.deposit : t.monthlyRent;
  return Number.isFinite(v) && v > 0 ? v : null;
}
export function rowsOfMode(rows, mode) {
  if (mode === 'jeonse') return rows.filter((t) => t.isJeonse);
  if (mode === 'wolse') return rows.filter((t) => t.isJeonse === false);
  return rows;
}

// 공급 평형(추정)별 묶음 — [{ value: '34', label: '34평(84㎡)', count }], 평형 작은 순
export function pyeongOptions(rows) {
  const groups = {};
  rows.forEach((t) => {
    const p = supplyPyeong(t.area);
    if (p == null) return;
    const g = (groups[p] ||= { count: 0, sqm: {} });
    g.count += 1;
    const sqm = Math.round(t.area);
    g.sqm[sqm] = (g.sqm[sqm] || 0) + 1;
  });
  return Object.keys(groups).map(Number).sort((a, b) => a - b).map((p) => {
    const sqm = Object.entries(groups[p].sqm).sort((a, b) => b[1] - a[1])[0][0];
    return { value: String(p), label: `${p}평`, sqm: Number(sqm), count: groups[p].count };
  });
}
// 거래가 가장 많은 평형(같으면 작은 평형) — 처음 열 때 고르는 값
export function topPyeong(options) {
  let best = null;
  options.forEach((o) => { if (!best || o.count > best.count) best = o; });
  return best ? best.value : 'all';
}

const natural = (a, b) => a.localeCompare(b, 'ko', { numeric: true });
export function aptDongOptions(rows) {
  return [...new Set(rows.map((t) => String(t.aptDong || '').trim()).filter(Boolean))].sort(natural);
}
export function floorOptions(rows) {
  return [...new Set(rows.map(floorOf).filter((f) => f != null))].sort((a, b) => a - b);
}

export const inPyeong = (t, pyeong) => pyeong === 'all' || String(supplyPyeong(t.area)) === pyeong;
export const inUnit = (t, aptDong, floor) => (aptDong === 'all' || String(t.aptDong || '').trim() === aptDong)
  && (floor === 'all' || String(floorOf(t)) === String(floor));

// 월 평균(그래프 선) — [{ t: 그 달 15일, v, n }] 오래된 달부터
export function monthlyAverage(rows, mode) {
  const by = new Map();
  rows.forEach((t) => {
    const v = priceOfDeal(t, mode);
    if (v == null) return;
    const k = (num(t.year) || 0) * 100 + (num(t.month) || 0);
    const g = by.get(k) || { s: 0, n: 0 };
    g.s += v; g.n += 1;
    by.set(k, g);
  });
  return [...by.entries()].sort((a, b) => a[0] - b[0])
    .map(([k, g]) => ({ t: Date.UTC(Math.floor(k / 100), (k % 100) - 1, 15), v: Math.round(g.s / g.n), n: g.n }));
}

// API 응답(json.data[`${code}_${ym}`]) → 이 단지 거래만, 최근 계약일 먼저
export function complexRowsFromApi(json, regionCode, apt, dong) {
  const rows = [];
  (json?.months || []).forEach((ym) => {
    (json?.data?.[`${regionCode}_${ym}`] || []).forEach((r) => {
      if (r.apt === apt && r.dong === dong) rows.push({ ...r, regionCode });
    });
  });
  return rows.sort((a, b) => dealDateNum(b) - dealDateNum(a));
}

// 조회 기간 { start, end }(YYYYMM) — 이번 달부터 monthsBack개월 전까지
export function ymRange(monthsBack, today = new Date()) {
  const f = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  return { start: f(new Date(today.getFullYear(), today.getMonth() - monthsBack, 1)), end: f(today) };
}

// 그래프 가로축 눈금 — minTs~maxTs 사이 달의 1일(UTC)을 최대 maxCount개, 고른 간격으로
export function monthTicks(minTs, maxTs, maxCount = 6) {
  if (!Number.isFinite(minTs) || !Number.isFinite(maxTs) || maxTs < minTs) return [];
  const a = new Date(minTs);
  const b = new Date(maxTs);
  let y = a.getUTCFullYear();
  let m = a.getUTCMonth() + 1; // 첫 눈금은 minTs 다음 달 1일
  if (m > 11) { y += 1; m = 0; }
  const span = (b.getUTCFullYear() - y) * 12 + (b.getUTCMonth() - m);
  if (span < 0) return [Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1)];
  const step = Math.max(1, Math.ceil((span + 1) / maxCount));
  const out = [];
  for (let k = 0; k <= span; k += step) out.push(Date.UTC(y, m + k, 1));
  return out;
}

// 만원 → "12.3억" / "9,800만"
export function fmtEok(v, digits = 1) {
  if (!Number.isFinite(v)) return '-';
  if (Math.abs(v) >= 10000) {
    const e = v / 10000;
    return `${e.toFixed(Math.max(1, digits)).replace(/0+$/, '').replace(/\.$/, '')}억`; // 12.30 → 12.3, 12.00 → 12
  }
  return `${Math.round(v).toLocaleString()}만`;
}
// 거래 하나의 가격 글자 — 매매 "12.3억", 전세 "전세 6억", 월세 "월세 1억/120"
export function dealPriceText(t, deal) {
  if (deal === 'trade') return fmtEok(t.amount, 2);
  if (t.isJeonse) return `전세 ${fmtEok(t.deposit, 2)}`;
  return `월세 ${fmtEok(t.deposit, 2)}/${Math.round(t.monthlyRent || 0).toLocaleString()}`;
}

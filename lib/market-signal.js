// v235: 지도 "시장 신호" 색칠 — 가격변동(평균 평당가)과 거래량변동(거래 건수)을 함께 보고 지역 상태를 6가지로 나눈다.
// 두 값 모두 lib/market-change.js buildChangeIndex(조회 기간 앞 절반 → 뒤 절반)의 결과를 그대로 쓴다. 화면 요소 없는 순수 함수.
// 기준(결과를 보기 전에 정함): 가격 ±1%, 거래량 ±10%.

export const SIGNALS = [
  // idx는 지도 색칠 값(1~6). 순서는 범례 순서.
  { idx: 1, key: 'hot', label: '상승 강세', desc: '가격↑ 거래↑', color: '#B23A2E' },
  { idx: 2, key: 'up', label: '상승 둔화', desc: '가격↑ 거래 그대로·↓', color: '#E9A497' },
  { idx: 3, key: 'heat', label: '거래 먼저 늘어남', desc: '가격 보합 거래↑', color: '#E3B341' },
  { idx: 4, key: 'flat', label: '보합', desc: '가격·거래 큰 변화 없음', color: '#DAD6CC' },
  { idx: 5, key: 'rebound', label: '바닥 다지기', desc: '가격↓ 거래↑', color: '#6FB39A' },
  { idx: 6, key: 'down', label: '하락 침체', desc: '가격↓ 거래 그대로·↓', color: '#2E63B2' },
];
const BY_IDX = new Map(SIGNALS.map((s) => [s.idx, s]));

export function classifySignal(pricePct, volPct, { priceTh = 1, volTh = 10 } = {}) {
  if (!Number.isFinite(pricePct) || !Number.isFinite(volPct)) return null;
  const volUp = volPct >= volTh;
  if (pricePct >= priceTh) return BY_IDX.get(volUp ? 1 : 2);
  if (pricePct <= -priceTh) return BY_IDX.get(volUp ? 5 : 6);
  return BY_IDX.get(volUp ? 3 : 4);
}

// priceIdx·volIdx: buildChangeIndex 결과(Map key → { pct, nEarly, nLate }). 둘 다 있는 지역만 신호를 낸다(하나라도 표본 부족이면 회색).
export function combineSignals(priceIdx, volIdx, opts) {
  const out = new Map();
  if (!priceIdx || !volIdx) return out;
  priceIdx.forEach((p, key) => {
    const v = volIdx.get(key);
    if (!v) return;
    const s = classifySignal(p.pct, v.pct, opts);
    if (s) out.set(key, { idx: s.idx, signal: s, pricePct: p.pct, volPct: v.pct, volEarly: v.nEarly, volLate: v.nLate });
  });
  return out;
}

export const signalColor = (idx) => BY_IDX.get(Math.round(idx))?.color || null;
export const signalLabel = (idx) => BY_IDX.get(Math.round(idx))?.label || '-';

const pct = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
// 툴팁 근거: "가격 +3.2% · 거래 +25% (20→25건)"
export function signalNote(entry) {
  if (!entry) return '';
  return `가격 ${pct(entry.pricePct)} · 거래 ${pct(entry.volPct)} (${entry.volEarly}→${entry.volLate}건)`;
}

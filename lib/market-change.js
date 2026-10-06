// 지도 "가격변동" 색칠 모드의 계산: 조회 기간을 앞쪽 절반과 뒤쪽 절반의 달로 나눠서,
// 지역(또는 동)별 평균 평당가가 앞→뒤로 얼마나 변했는지(%)를 구한다. 화면 요소 없이 숫자만 다루는 순수 함수.
//
// 한계(화면에도 안내한다): 같은 단지가 두 기간에 모두 거래된 게 아니라 "그 기간에 거래된 단지들의 평균"을
// 비교하는 거라, 거래된 단지 구성(큰 평형·신축이 몰린 달 등)에 따라 실제 시세와 다르게 보일 수 있다.
// 그래서 표본이 적은 곳(기간별 minPerHalf건 미만)은 변화율을 내지 않고 회색으로 둔다.

// 달(yyyymm 정수) 목록을 앞/뒤 절반으로 나눈다. 달이 홀수면 가운데 달은 어느 쪽에도 넣지 않는다.
export function splitMonths(yms) {
  const sorted = [...new Set(yms.filter(Number.isFinite))].sort((a, b) => a - b);
  const h = Math.floor(sorted.length / 2);
  return {
    early: new Set(sorted.slice(0, h)),
    late: new Set(sorted.slice(sorted.length - h)),
    usable: h >= 1,
  };
}

// rows: 거래 목록. keyOf(row)=묶을 기준(지역코드 등, null이면 건너뜀), valueOf(row)=평당가(없으면 건너뜀),
// ymOf(row)=yyyymm 정수. 반환: Map(key → { pct, nEarly, nLate }) — 표본이 모자란 키는 들어 있지 않다.
// mode:
//   'avg'   (기본) 앞→뒤 평균 평당가 변화율. 앞·뒤 기간 모두 minPerHalf건 이상이어야 계산한다.
//   'count' 앞→뒤 거래 건수 변화율. 평당가가 없는 거래도 한 건으로 센다(기존 "거래량" 색칠과 같은 기준).
//           분모가 되는 앞 기간이 minPerHalf건 이상이어야 계산하고, 뒤 기간이 0건이면 -100%다.
//           (앞·뒤는 같은 개수의 달이라 건수를 그대로 비교할 수 있다.)
export function buildChangeIndex(rows, { keyOf, valueOf, ymOf, minPerHalf = 3, mode = 'avg' }) {
  const out = new Map();
  const list = rows || [];
  // 달 나누기는 전체 거래 기준으로 한 번만 해서 모든 지역이 같은 앞/뒤 기간을 쓰게 한다.
  const { early, late, usable } = splitMonths(list.map(ymOf));
  if (!usable) return out;
  const acc = new Map();
  list.forEach((r) => {
    const key = keyOf(r);
    if (key == null) return;
    const v = mode === 'count' ? 0 : valueOf(r);
    if (mode !== 'count' && (!Number.isFinite(v) || v <= 0)) return;
    const ym = ymOf(r);
    const half = early.has(ym) ? 0 : late.has(ym) ? 1 : -1;
    if (half < 0) return;
    let a = acc.get(key);
    if (!a) { a = [{ sum: 0, n: 0 }, { sum: 0, n: 0 }]; acc.set(key, a); }
    a[half].sum += v;
    a[half].n += 1;
  });
  acc.forEach((a, key) => {
    if (mode === 'count') {
      if (a[0].n < minPerHalf) return;
      out.set(key, { pct: (a[1].n / a[0].n - 1) * 100, nEarly: a[0].n, nLate: a[1].n });
      return;
    }
    if (a[0].n < minPerHalf || a[1].n < minPerHalf) return;
    const earlyAvg = a[0].sum / a[0].n;
    const lateAvg = a[1].sum / a[1].n;
    out.set(key, { pct: (lateAvg / earlyAvg - 1) * 100, nEarly: a[0].n, nLate: a[1].n });
  });
  return out;
}

// 색: 0이 가운데(연한 회색), 오르면 빨강, 내리면 파랑. cap(%)이면 가장 진한 색.
// cap은 값들의 가장 큰 변화폭을 따르되 3~15%로 제한한다(작은 변화가 의미 없이 진해지거나 이상치 하나가 나머지를 다 흐리게 만들지 않도록).
const NEUTRAL = [245, 244, 239];
const UP = [178, 58, 46];
const DOWN = [46, 99, 178];
// 평당가 변화는 몇 %만 움직여도 큰 차이라 3~15%, 거래량 변화는 훨씬 크게 출렁여서 20~100%로 둔다.
export function changeCap(values, { min = 3, max = 15 } = {}) {
  const maxAbs = (values || []).filter(Number.isFinite).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  return Math.min(max, Math.max(min, maxAbs));
}
export function changeColor(value, cap) {
  if (!Number.isFinite(value)) return null;
  const t = Math.max(-1, Math.min(1, value / cap));
  const to = t >= 0 ? UP : DOWN;
  const k = Math.abs(t);
  return `rgb(${NEUTRAL.map((c, i) => Math.round(c + (to[i] - c) * k)).join(',')})`;
}
export const formatChange = (v) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : '-');

// 툴팁에 함께 보여줄 근거(표본 수). 색만 보고 "왜 이 색인지" 알 수 없던 문제를 줄인다.
export function changeNote(entry, mode = 'avg') {
  if (!entry) return '';
  return mode === 'count' ? `거래 ${entry.nEarly}→${entry.nLate}건` : `표본 ${entry.nEarly}→${entry.nLate}건`;
}

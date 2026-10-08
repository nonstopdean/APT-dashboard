// 비교분석 탭의 "장기 시세 비교" 계산(순수 함수). 화면에 묶인 조회 기간(기본 6개월)과 상관없이
// 1~10년 실거래를 받아, 같은 평형대끼리 월/분기별 평균 평당가를 낸다.

export const LONG_PERIODS = [
  { key: '1y', label: '1년', months: 12 },
  { key: '3y', label: '3년', months: 36 },
  { key: '5y', label: '5년', months: 60 },
  { key: '10y', label: '10년', months: 120 },
];

// 정부 통계에서 쓰는 전용면적 구분(소형·중소형·중대형).
export const AREA_BUCKETS = [
  { key: 'all', label: '전체', test: () => true },
  { key: 'small', label: '60㎡ 이하', test: (a) => a <= 60 },
  { key: 'mid', label: '60~85㎡', test: (a) => a > 60 && a <= 85 },
  { key: 'large', label: '85㎡ 초과', test: (a) => a > 85 },
];

export function ymShiftLC(ym, delta) {
  const y = Number(String(ym).slice(0, 4));
  const m = Number(String(ym).slice(4, 6)) - 1 + delta;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}${String(mm + 1).padStart(2, '0')}`;
}

// 5년 이상은 분기로 묶는다(월별은 표본이 적어 들쭉날쭉하다).
export function bucketOf(ym, unit) {
  if (unit !== 'quarter') return String(ym);
  const y = String(ym).slice(0, 4);
  const q = Math.floor((Number(String(ym).slice(4, 6)) - 1) / 3) + 1;
  return `${y}Q${q}`;
}

export function bucketLabel(b) {
  const s = String(b);
  if (s.includes('Q')) return `${s.slice(2, 4)}.${s.slice(4)}`; // 2024Q3 → 24.Q3
  return `${s.slice(2, 4)}.${s.slice(4, 6)}`; // 202409 → 24.09
}

// 시작~끝 사이의 모든 구간 키(데이터가 없는 구간도 빈칸으로 남겨 선이 끊겨 보이게 한다).
export function bucketRange(startYm, endYm, unit) {
  const out = [];
  let ym = startYm;
  for (let i = 0; i < 400 && ym <= endYm; i += 1) {
    const b = bucketOf(ym, unit);
    if (out[out.length - 1] !== b) out.push(b);
    ym = ymShiftLC(ym, 1);
  }
  return out;
}

const ymOfRow = (r) => `${r.year}${String(r.month).padStart(2, '0')}`;

// rows: 실거래 행 목록. valueOf: 행 → 평당가(만원) 또는 null. 반환: 구간별 { bucket, value, n }.
export function buildLongSeries(rows, {
  startYm, endYm, unit = 'month', areaKey = 'all', valueOf, minN = 1,
}) {
  // minN: 이 건수보다 적은 구간은 빈칸으로 둔다. 지역 평균은 거래 몇 건짜리 구간(예: 이번 달 초)이
  // 싼 거래 하나에 크게 흔들려서(v174 송파 26.Q4 "0.45억") 호출하는 쪽이 10을 넘긴다.
  const area = AREA_BUCKETS.find((a) => a.key === areaKey) || AREA_BUCKETS[0];
  const sums = new Map();
  (rows || []).forEach((r) => {
    const ym = ymOfRow(r);
    if (ym < startYm || ym > endYm) return;
    if (!Number.isFinite(r.area) || !area.test(r.area)) return;
    const v = valueOf(r);
    if (!Number.isFinite(v)) return;
    const b = bucketOf(ym, unit);
    const cur = sums.get(b) || { s: 0, n: 0 };
    cur.s += v;
    cur.n += 1;
    sums.set(b, cur);
  });
  return bucketRange(startYm, endYm, unit).map((b) => {
    const c = sums.get(b);
    return { bucket: b, value: c && c.n >= minN ? c.s / c.n : null, n: c ? c.n : 0 };
  });
}

// 요약: 처음·마지막 값이 있는 구간 기준 등락률, 최고 구간, 총 거래 수.
export function summarizeLongSeries(series) {
  const withData = (series || []).filter((s) => s.value != null);
  if (!withData.length) return { latest: null, changePct: null, peak: null, count: 0 };
  const first = withData[0];
  const last = withData[withData.length - 1];
  const peak = withData.reduce((a, b) => (b.value > a.value ? b : a));
  return {
    latest: last.value,
    latestBucket: last.bucket,
    changePct: first.value ? ((last.value - first.value) / first.value) * 100 : null,
    firstBucket: first.bucket,
    peak,
    count: withData.reduce((s, x) => s + x.n, 0),
  };
}

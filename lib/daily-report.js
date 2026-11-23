// v250: 수도권 "일일 신고" 리포트 — 매일 크론(app/api/daily-snapshot)이 최근 실거래를 받아 전날 저장본과 비교해
// "새로 공개된 거래(= 그날 신고분)"를 가려낸다. 국토부 자료엔 신고일이 없어서 이렇게 날마다 차이를 본다.
// 여기는 화면 요소·저장소 없는 순수 함수만 둔다.

export const CAPITAL_SIDOS = ['서울특별시', '인천광역시', '경기도'];
export const SIDO_SHORT = { 서울특별시: '서울', 인천광역시: '인천', 경기도: '경기' };

// 시·도의 맨 아래 단위 지역만(구가 있는 시는 시 대신 구들) — "수원시"와 "수원시 장안구"를 함께 받으면 두 번 센다.
export function leafRegions(groups, sidos = CAPITAL_SIDOS) {
  const out = [];
  (groups || []).filter((g) => sidos.includes(g.sido)).forEach((g) => {
    g.items.forEach((it) => {
      const hasChild = g.items.some((o) => o !== it && String(o.name).startsWith(`${it.name} `));
      if (!hasChild) out.push({ code: it.code, name: it.name, sido: g.sido });
    });
  });
  return out;
}

// 거래 하나의 지문(같은 단지·동·면적·층·계약일·금액이면 같은 거래) — 짧게 저장하려고 32비트 해시를 36진수로.
export function fpOf(t) {
  const s = `${t.apt}|${t.dong}|${t.area}|${t.floor}|${t.year}${t.month}${t.day}|${t.amount}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
export function countsOf(trades) {
  const c = {};
  (trades || []).forEach((t) => { const f = fpOf(t); c[f] = (c[f] || 0) + 1; });
  return c;
}
// 전날 지문 개수보다 많아진 만큼만 "새 거래"(같은 거래가 두 건이어도 맞게 센다)
export function diffNew(prevCounts, trades) {
  const left = { ...(prevCounts || {}) };
  const out = [];
  (trades || []).forEach((t) => {
    const f = fpOf(t);
    if (left[f] > 0) left[f] -= 1; else out.push(t);
  });
  return out;
}

export const caKey = (t) => `${t.apt}|${t.dong}|${Math.round(Number(t.area))}`;
const dnum = (t) => Number(t.year) * 10000 + Number(t.month) * 100 + Number(t.day || 0);

// 단지·면적별 최고가 표 갱신 — { caKey: [최고가, 계약일YYYYMMDD] }
export function updateMax(maxMap, trades) {
  const m = maxMap || {};
  (trades || []).forEach((t) => {
    if (!Number.isFinite(t.amount)) return;
    const k = caKey(t);
    if (!m[k] || t.amount > m[k][0]) m[k] = [t.amount, dnum(t)];
  });
  return m;
}

// 화면·저장용으로 줄인 거래
export const compact = (t, code) => ({
  c: code, a: t.apt, g: t.dong, ar: t.area, f: t.floor, y: Number(t.year), m: Number(t.month), d: Number(t.day),
  p: t.amount, by: t.buildYear || null, u: Number.isFinite(t.pricePerPyeong) ? Math.round(t.pricePerPyeong) : null,
});

// 그날 리포트 — perRegion: [{ code, sido, newTrades, maxBefore }]. 신고가 = 저장된 최고가(이전 날까지)를 넘긴 새 거래.
export function buildDailyReport({ date, perRegion, months, failed = [], baseline = [] }) {
  const all = [];
  const highs = [];
  const bySido = {};
  const byRegion = [];
  (perRegion || []).forEach((r) => {
    const sido = SIDO_SHORT[r.sido] || r.sido;
    bySido[sido] = (bySido[sido] || 0) + r.newTrades.length;
    let nHigh = 0;
    r.newTrades.forEach((t) => {
      const ct = compact(t, r.code);
      all.push(ct);
      const prev = r.maxBefore ? r.maxBefore[caKey(t)] : null;
      if (prev && t.amount > prev[0]) { highs.push({ ...ct, pm: prev[0], pd: prev[1] }); nHigh += 1; }
    });
    if (r.newTrades.length) byRegion.push({ code: r.code, n: r.newTrades.length, h: nHigh });
  });
  all.sort((a, b) => b.p - a.p);
  highs.sort((a, b) => b.p - a.p);
  byRegion.sort((a, b) => b.n - a.n);
  return {
    date, months, total: all.length, bySido, byRegion,
    highs: highs.slice(0, 300), highCount: highs.length,
    trades: all.slice(0, 1500),
    failed, baseline,
  };
}

// v251: ym(YYYYMM) 바로 앞 n개월 — 가까운 달부터 [ym-1, ym-2, …]
export function monthsBefore(ym, n) {
  const y = Number(String(ym).slice(0, 4));
  const m = Number(String(ym).slice(4, 6)) - 1;
  const out = [];
  for (let i = 1; i <= n; i += 1) {
    const d = new Date(Date.UTC(y, m - i, 1));
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
// v251: 과거 채우기 순서 — 달 우선(가까운 달의 모든 지역 → 그다음 달). i번째 작업 = (지역, 달)
export const backfillTask = (i, regionCount, backMonths) => ({ regionIdx: i % regionCount, ym: backMonths[Math.floor(i / regionCount)] });

// 한국 시간 날짜 YYYYMMDD
export function kstDate(now = new Date()) {
  const k = new Date(now.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, '0')}${String(k.getUTCDate()).padStart(2, '0')}`;
}
// 받을 달 — 신고 기한 30일이라 평소엔 이번 달·지난달, 매달 1~3일엔 지지난달까지(지지난달 말 계약이 지난달 말에 신고될 수 있어서)
export function monthsToFetch(now = new Date()) {
  const k = new Date(now.getTime() + 9 * 3600 * 1000);
  const n = k.getUTCDate() <= 3 ? 3 : 2;
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

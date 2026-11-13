import { supplyPyeong } from './pyeong';

// v225: 전고점 대비(아실의 "최고가 대비") — 단지·평형(전용 ㎡ 반올림, 상세 창 평형 칩과 같은 기준)별로
// 받은 기간 안의 최고가와 가장 최근 거래가를 비교한다.
// trades: 매매 행 [{ regionCode, dong, apt, area(㎡), amount(만원), year, month, day }]
// recentFromYm: 이 달(YYYYMM, 숫자) 이후에 거래가 있는 평형만 남긴다(오래전 거래만 있으면 "지금"과 비교할 수 없다).
// 최근 거래가: 가장 마지막 거래일의 거래(같은 날 여러 건이면 평균). 최고가가 같은 값으로 여러 번이면 가장 이른 날.
const ymdOf = (t) => Number(t.year) * 10000 + Number(t.month) * 100 + (Number(t.day) || 1);

export function peakDropRows(trades, { recentFromYm } = {}) {
  const groups = new Map();
  (trades || []).forEach((t) => {
    const amt = Number(t.amount);
    const area = Math.round(Number(t.area));
    if (!t.regionCode || !t.dong || !t.apt || !(amt > 0) || !(area > 0) || !(Number(t.year) > 0)) return;
    // v226: 해제된 거래와 직거래(가족 간 거래 등 시세와 동떨어질 수 있음)는 뺀다. 아실도 같은 기준.
    if (t.cancelled || t.dealGbn === '직거래') return;
    const key = `${t.regionCode}|${t.dong}|${t.apt}`;
    const gk = `${key}|${area}`;
    let g = groups.get(gk);
    if (!g) {
      g = { key, regionCode: t.regionCode, dong: t.dong, apt: t.apt, area, list: [] };
      groups.set(gk, g);
    }
    g.list.push({ d: ymdOf(t), amt });
  });
  const out = [];
  groups.forEach((g) => {
    let peak = null;
    let lastD = 0;
    g.list.forEach((x) => {
      if (!peak || x.amt > peak.amt || (x.amt === peak.amt && x.d < peak.d)) peak = x;
      if (x.d > lastD) lastD = x.d;
    });
    if (recentFromYm && Math.floor(lastD / 100) < recentFromYm) return;
    const lastAmts = g.list.filter((x) => x.d === lastD).map((x) => x.amt);
    const latest = lastAmts.reduce((s, v) => s + v, 0) / lastAmts.length;
    out.push({
      key: g.key, regionCode: g.regionCode, dong: g.dong, apt: g.apt, area: g.area, pyeong: supplyPyeong(g.area),
      n: g.list.length, peak: peak.amt, peakDate: peak.d, latest, latestDate: lastD,
      dropPct: ((latest - peak.amt) / peak.amt) * 100,
    });
  });
  return out.sort((a, b) => a.dropPct - b.dropPct);
}

// 20211005 → "21.10"
export function ymdShort(d) {
  const s = String(d || '');
  return s.length >= 6 ? `${s.slice(2, 4)}.${s.slice(4, 6)}` : '-';
}

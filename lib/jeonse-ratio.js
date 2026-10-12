// 한 단지의 전세가율(%) = 전세 보증금 평당 평균 ÷ 매매 평당가 평균 × 100 (v189, 비교분석 탭 단지 비교 표).
// 같은 기간·같은 단지의 거래만 넣는다. 평형 구성이 매매와 전세에서 다를 수 있어 근사치다.
// saleRows: 매매 실거래 행(pricePerPyeong), rentRows: 전월세 행(isJeonse, depositPerPyeong) — 월세는 뺀다.
export function jeonseRatio(saleRows, rentRows) {
  const sale = (saleRows || []).map((r) => Number(r.pricePerPyeong)).filter((v) => Number.isFinite(v) && v > 0);
  const jeonse = (rentRows || []).filter((r) => r.isJeonse).map((r) => Number(r.depositPerPyeong)).filter((v) => Number.isFinite(v) && v > 0);
  const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const salePyeong = avg(sale);
  const jeonsePyeong = avg(jeonse);
  return {
    salePyeong, jeonsePyeong, nSale: sale.length, nJeonse: jeonse.length,
    ratio: salePyeong && jeonsePyeong ? (jeonsePyeong / salePyeong) * 100 : null,
  };
}

// 월별 전세가율 추이(v191, 단지 상세). months: ['202511', ...]. 그 달에 매매·전세가 둘 다 있어야 값이 생긴다.
export function jeonseRatioSeries(saleRows, rentRows, months) {
  const ymOf = (r) => `${r.year}${String(r.month).padStart(2, '0')}`;
  return (months || []).map((ym) => {
    const r = jeonseRatio((saleRows || []).filter((x) => ymOf(x) === ym), (rentRows || []).filter((x) => ymOf(x) === ym));
    return { ym, ratio: r.ratio, nSale: r.nSale, nJeonse: r.nJeonse };
  });
}

// 평형별 갭(v192, 단지 상세) = 매매가 중간값 − 전세 보증금 중간값(만원). 전용면적을 반올림한 ㎡로 묶고,
// 매매·전세가 둘 다 있는 면적만 돌려준다. 월세·보증금 0원 행은 뺀다.
export function gapByArea(saleRows, rentRows) {
  const median = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const groups = new Map();
  const add = (area, key, v) => {
    if (!Number.isFinite(area) || area <= 0 || !Number.isFinite(v) || v <= 0) return;
    const k = Math.round(area);
    if (!groups.has(k)) groups.set(k, { sale: [], jeonse: [] });
    groups.get(k)[key].push(v);
  };
  (saleRows || []).forEach((r) => add(Number(r.area), 'sale', Number(r.amount)));
  (rentRows || []).filter((r) => r.isJeonse).forEach((r) => add(Number(r.area), 'jeonse', Number(r.deposit)));
  return [...groups.entries()]
    .filter(([, g]) => g.sale.length && g.jeonse.length)
    .sort((a, b) => a[0] - b[0])
    .map(([area, g]) => {
      const sale = median(g.sale);
      const jeonse = median(g.jeonse);
      return { area, sale, jeonse, gap: sale - jeonse, ratio: (jeonse / sale) * 100, nSale: g.sale.length, nJeonse: g.jeonse.length };
    });
}

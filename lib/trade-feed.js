// 지도 패널의 "최근 거래" 피드 계산(순수 함수). 최근 N일 실거래를 날짜순으로 늘어놓고,
// 같은 단지·같은 전용면적(반올림 ㎡)의 "그 거래 이전" 최고가를 넘은 거래를 신고가로 표시한다.
// 조회 기간(기본 6개월)만 보면 신고가 판정이 틀리므로, 호출하는 쪽이 3년치 같은 긴 기간을 넘긴다.

export const dateKeyOf = (r) => `${r.year}${String(r.month).padStart(2, '0')}${String(r.day).padStart(2, '0')}`;

const toDate = (key) => new Date(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)));
const keyOfDate = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

export function shiftDays(key, days) {
  const d = toDate(key);
  d.setDate(d.getDate() + days);
  return keyOfDate(d);
}

const groupKeyOf = (r) => `${r.regionCode || ''}|${r.dong}|${r.apt}|${Math.round(r.area)}`;

// rows: 실거래 행(regionCode 포함 권장). todayKey: 'YYYYMMDD'.
// 반환: { items: [...최근 거래(최신순)], summary: { recent, prev, changePct, highs } }
export function buildTradeFeed(rows, { todayKey, recentDays = 30 }) {
  const valid = (rows || []).filter((r) => Number.isFinite(r.amount) && r.amount > 0 && Number.isFinite(r.area) && r.year && r.month && r.day);
  const recentStart = shiftDays(todayKey, -(recentDays - 1));
  const prevStart = shiftDays(todayKey, -(recentDays * 2 - 1));

  // 단지·면적별로 날짜순 정렬한 뒤, 각 거래 시점의 "이전 최고가"를 구한다(같은 날 거래끼리는 서로 비교하지 않는다).
  const groups = new Map();
  valid.forEach((r) => {
    const k = groupKeyOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  const annotated = [];
  groups.forEach((list) => {
    list.sort((a, b) => dateKeyOf(a).localeCompare(dateKeyOf(b)));
    let maxBefore = null; // 오늘 이전 날짜까지의 최고가
    let i = 0;
    while (i < list.length) {
      const day = dateKeyOf(list[i]);
      let j = i;
      while (j < list.length && dateKeyOf(list[j]) === day) j += 1;
      const sameDay = list.slice(i, j);
      sameDay.forEach((r) => {
        annotated.push({
          ...r,
          dateKey: day,
          prevMax: maxBefore,
          isHigh: maxBefore != null && r.amount > maxBefore,
          highPct: maxBefore != null && r.amount > maxBefore ? ((r.amount - maxBefore) / maxBefore) * 100 : null,
        });
      });
      const dayMax = Math.max(...sameDay.map((r) => r.amount));
      maxBefore = maxBefore == null ? dayMax : Math.max(maxBefore, dayMax);
      i = j;
    }
  });

  const items = annotated
    .filter((r) => r.dateKey >= recentStart && r.dateKey <= todayKey)
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.amount - a.amount);
  const prev = annotated.filter((r) => r.dateKey >= prevStart && r.dateKey < recentStart).length;
  const recent = items.length;
  return {
    items,
    summary: {
      recent,
      prev,
      changePct: prev ? ((recent - prev) / prev) * 100 : null,
      highs: items.filter((r) => r.isHigh).length,
    },
  };
}

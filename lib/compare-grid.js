import { fmtManwon, fmtPct, fmtArea, labelFor } from './ui-helpers';

// 비교함에 담은 단지들을 열로 나란히 놓은 표를 계산한다(화면 요소 없이 데이터만).
// pinned: [{ apt, dong, regionCode }] / rows: page.jsx의 complexCompare(단지별 최근 거래 + 평당가·변동률·거래 수).
//
// 주의할 점:
//  - "기간 내 변동"은 조회 기간 안에서 "가장 처음 거래 대비 최근 거래의 평당가 변화"이지 연간 변동률이 아니다.
//  - 가격은 평형이 다르면 비교가 안 되므로, 최저/최고 배지는 평당가에만 단다(거래가에는 달지 않는다).
//  - 거래가 없는 단지(조회 기간에 거래가 없거나 평당가를 못 구한 단지)는 '-'로 두고 배지 계산에서 뺀다.
//  - 값이 2개 이상이고 서로 다를 때만 배지를 단다(하나뿐이거나 전부 같으면 "최고"라고 할 근거가 없다).
export const MAX_PINNED = 5;

const toNum = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
};

export const pinnedKeyOf = (c) => `${c.regionCode}|${c.dong}|${c.apt}`;

export function buildCompareGrid(pinned, rows, { isRent = false, nowYear = new Date().getFullYear() } = {}) {
  const byKey = new Map((rows || []).map((r) => [pinnedKeyOf(r), r]));
  const list = pinned || [];
  const columns = list.map((p) => ({
    key: pinnedKeyOf(p), apt: p.apt, dong: p.dong, regionCode: p.regionCode,
    region: labelFor(p.regionCode), hasData: byKey.has(pinnedKeyOf(p)),
  }));

  const defs = [
    { id: 'price', label: isRent ? '최근 보증금' : '최근 거래가', value: (r) => toNum(isRent ? r.deposit : r.amount), format: (v) => fmtManwon(v) },
    { id: 'area', label: '전용면적', value: (r) => toNum(r.area), format: (v) => fmtArea(v) },
    {
      id: 'unit', label: isRent ? '보증금 평당' : '평당가', value: (r) => toNum(r.unitPrice),
      format: (v) => `${Math.round(v).toLocaleString()}만`, badges: { min: '최저', max: '최고' },
    },
    {
      id: 'change', label: '기간 내 변동', value: (r) => toNum(r.change), format: (v) => fmtPct(v),
      tone: (v) => (v > 0 ? 'up' : v < 0 ? 'down' : null),
      badges: { max: '상승폭 최대', min: '하락폭 최대' }, maxOk: (v) => v > 0, minOk: (v) => v < 0,
    },
    { id: 'count', label: '거래 건수', value: (r) => toNum(r.count), format: (v) => `${v}건`, badges: { max: '최다' } },
    {
      id: 'age', label: '준공', value: (r) => toNum(r.buildYear), format: (v) => `${v}년 (${nowYear - v}년차)`,
      badges: { max: '가장 신축', min: '가장 구축' },
    },
  ];

  const outRows = defs.map((d) => {
    const vals = list.map((p) => {
      const r = byKey.get(pinnedKeyOf(p));
      return r ? d.value(r) : null;
    });
    const present = vals.filter((v) => v != null);
    const max = present.length ? Math.max(...present) : null;
    const min = present.length ? Math.min(...present) : null;
    const canBadge = present.length >= 2 && max !== min;
    const cells = vals.map((v) => {
      if (v == null) return { text: '-', tone: null, badge: null };
      let badge = null;
      if (canBadge && d.badges) {
        if (v === max && d.badges.max && (!d.maxOk || d.maxOk(v))) badge = d.badges.max;
        else if (v === min && d.badges.min && (!d.minOk || d.minOk(v))) badge = d.badges.min;
      }
      return { text: d.format(v), tone: d.tone ? d.tone(v) : null, badge };
    });
    return { id: d.id, label: d.label, cells };
  });
  return { columns, rows: outRows };
}

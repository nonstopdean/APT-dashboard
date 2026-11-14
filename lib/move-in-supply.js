import { REGION_GROUPS } from './regions';

// v231: 구별 입주 물량. 청약홈 분양 공고(입주예정월·공급 세대수·주소)를 시·군·구별로 모은다.
// 주의: 청약 공고에 나온 공급 세대수라서 재건축·재개발 조합원 물량, 공공임대 등 공고 없이 들어오는 세대는 빠진다.

const SIDO_SHORT = {
  서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주',
  대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종', 경기도: '경기', 강원특별자치도: '강원',
  충청북도: '충북', 충청남도: '충남', 전북특별자치도: '전북', 전라남도: '전남', 경상북도: '경북',
  경상남도: '경남', 제주특별자치도: '제주',
};
// 공고 주소에는 옛 이름(강원도·전라북도)도 섞여 있다.
const OLD_SIDO = { 강원도: '강원특별자치도', 전라북도: '전북특별자치도' };

// "경기도 수원시 영통구 원천동 633번지 일원" → { code, name: '수원시 영통구' }. 시·도 다음 낱말들과 가장 길게 맞는 지역.
// "경기도 시흥시 거모지구 내 A-6블록"처럼 동이 없어도 시·군·구까지만 맞으면 된다. 못 정하면 null.
// 실제 공고 주소에서 본 모양: "경기도 화성특례시 동탄2 …"(특례시 → 시로 읽음), "경기도 용인고림지구 H5BL(경기도 용인시 처인구 …)"·
// "김포 풍무역세권 B5블록(경기도 김포시 …)"(앞에서 못 정하면 괄호 안·중간에 나오는 시·도부터 다시 찾음).
const groupOfToken = (tok) => {
  const t = OLD_SIDO[tok] || tok;
  return REGION_GROUPS.find((g) => g.sido === t || SIDO_SHORT[g.sido] === t) || null;
};
function matchFrom(group, rest) {
  let best = null;
  let bestLen = 0;
  group.items.forEach((it) => {
    if (it.name === group.sido) { if (!best) best = it; return; } // 세종
    const parts = it.name.split(/\s+/);
    if (parts.length <= rest.length && parts.every((p, i) => rest[i] === p) && parts.length > bestLen) {
      best = it; bestLen = parts.length;
    }
  });
  return best;
}
// sidoHint: 공고의 공급지역(예: '경기') — 주소에 시·도가 없거나("수원시 장안구 연무동 …") 새 이름("전남광주통합특별시 북구 …")이면
// 그 시·도 안에서 구·시 이름을 주소 어디서든 찾는다.
export function regionOfAddress(address, sidoHint) {
  const tokens = String(address || '').trim()
    .replace(/[,()[\]]/g, ' ')
    .replace(/(\S+)특례시(?=\s|$)/g, '$1시')
    .split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const group = groupOfToken(tokens[i]);
    if (!group) continue;
    const best = matchFrom(group, tokens.slice(i + 1));
    if (best && (best.name !== group.sido || i === 0)) return { code: best.code, name: best.name };
  }
  const hint = sidoHint ? groupOfToken(String(sidoHint).trim()) : null;
  if (hint) {
    if (hint.items.length === 1) return { code: hint.items[0].code, name: hint.items[0].name }; // 세종
    let best = null;
    for (let i = 0; i < tokens.length; i += 1) {
      const b = matchFrom(hint, tokens.slice(i));
      if (b && b.name !== hint.sido && (!best || b.name.split(/\s+/).length > best.name.split(/\s+/).length)) best = b;
    }
    if (best) return { code: best.code, name: best.name };
  }
  return null;
}

const ymOk = (ym) => /^\d{6}$/.test(String(ym || '').trim());

// rows: [{ houseName, address, totalUnits, moveInMonth('YYYYMM'), announceDate }]
// fromYm·toYm(포함) 사이에 입주하는 공고를 지역별로 합친다 → [{ code, name, units, count, items }] 세대수 많은 순.
// 같은 공고가 두 번 들어오지 않게 (주택명·주소·입주월·세대수)가 같으면 한 번만 센다.
export function moveInByRegion(rows, fromYm, toYm) {
  const byCode = new Map();
  const seen = new Set();
  (rows || []).forEach((r) => {
    const ym = String(r.moveInMonth || '').trim();
    if (!ymOk(ym) || ym < fromYm || ym > toYm) return;
    const units = parseInt(r.totalUnits, 10);
    if (!Number.isFinite(units) || units <= 0) return;
    const id = `${r.houseName}|${r.address}|${ym}|${units}`;
    if (seen.has(id)) return;
    seen.add(id);
    const reg = regionOfAddress(r.address, r.area);
    const code = reg ? reg.code : '?';
    if (!byCode.has(code)) byCode.set(code, { code, name: reg ? reg.name : '지역 확인 안 됨', units: 0, count: 0, items: [] });
    const g = byCode.get(code);
    g.units += units;
    g.count += 1;
    g.items.push({ houseName: r.houseName, address: r.address, units, moveInYm: ym, url: r.url });
  });
  const out = [...byCode.values()];
  out.forEach((g) => g.items.sort((a, b) => a.moveInYm.localeCompare(b.moveInYm) || b.units - a.units));
  return out.sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
}

// 지역 × 연도 표: years(예: [2025, 2026, 2027, 2028]) 각 해의 입주 세대수. 지역은 전체 기간 합이 큰 순.
export function moveInYearTable(rows, years) {
  if (!years.length) return [];
  const from = `${years[0]}01`;
  const to = `${years[years.length - 1]}12`;
  const groups = moveInByRegion(rows, from, to);
  return groups.map((g) => {
    const byYear = Object.fromEntries(years.map((y) => [y, 0]));
    g.items.forEach((it) => { byYear[Number(it.moveInYm.slice(0, 4))] += it.units; });
    return { code: g.code, name: g.name, byYear, total: g.units };
  });
}

// 한 지역(또는 전체: code 없음)의 월별 입주 세대수 — 빈 달은 0으로 채운다.
export function moveInMonthly(rows, fromYm, toYm, code) {
  const months = [];
  let y = Number(fromYm.slice(0, 4));
  let m = Number(fromYm.slice(4, 6));
  for (let guard = 0; guard < 240; guard += 1) {
    const ym = `${y}${String(m).padStart(2, '0')}`;
    if (ym > toYm) break;
    months.push(ym);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  const sums = Object.fromEntries(months.map((ym) => [ym, 0]));
  moveInByRegion(rows, fromYm, toYm).forEach((g) => {
    if (code && g.code !== code) return;
    g.items.forEach((it) => { sums[it.moveInYm] += it.units; });
  });
  return months.map((ym) => ({ ym, label: `${ym.slice(2, 4)}.${ym.slice(4, 6)}`, 세대수: sums[ym] }));
}

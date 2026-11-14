import { REGION_GROUPS } from './regions';
import { normalizeComplexName } from './complex-match';

// v229: 전국 단지 이름 검색(카카오 키워드 검색 결과 → 우리 지역 코드·동·지번)과,
// 고른 단지를 불러온 실거래 단지 목록 안에서 찾아 맞추는 순수 함수들. 서버(app/api/complex-search)와 화면(page.jsx)이 같이 쓴다.

// 카카오 주소의 시·도 표기(짧은 이름 또는 특별자치 정식 이름) ↔ regions.js의 시·도 이름.
const SIDO_SHORT = {
  서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주',
  대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종', 경기도: '경기', 강원특별자치도: '강원',
  충청북도: '충북', 충청남도: '충남', 전북특별자치도: '전북', 전라남도: '전남', 경상북도: '경북',
  경상남도: '경남', 제주특별자치도: '제주',
};
const sidoMatches = (groupSido, token) => token === groupSido || token === SIDO_SHORT[groupSido]
  || (SIDO_SHORT[groupSido] && token.startsWith(SIDO_SHORT[groupSido]) && /(특별자치|광역|특별)?(시|도)$/.test(token));

// "서울 송파구 가락동 913" / "경기 수원시 영통구 이의동 1350" / "세종특별자치시 반곡동 123-4"
// → { regionCode, regionName, dong, jibun }. 지역을 못 정하면 null. 같은 시 안의 구 이름이 여럿 맞으면 가장 긴 이름(구까지)을 고른다.
export function parseKakaoAddress(addressName) {
  const tokens = String(addressName || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const group = REGION_GROUPS.find((g) => sidoMatches(g.sido, tokens[0]));
  if (!group) return null;
  const rest = tokens.slice(1);
  let best = null;
  let bestLen = 0;
  group.items.forEach((it) => {
    const parts = it.name.split(/\s+/);
    // 세종처럼 시·도 이름과 같은 항목은 시·도 다음 글자가 바로 동이다.
    if (it.name === group.sido) {
      if (!best) { best = it; bestLen = 0; }
      return;
    }
    if (parts.length <= rest.length && parts.every((p, i) => rest[i] === p) && parts.length > bestLen) {
      best = it; bestLen = parts.length;
    }
  });
  if (!best) return null;
  const after = rest.slice(bestLen);
  // 마지막 덩어리가 지번(숫자, "산12-3"처럼 산 포함)이면 떼어낸다. 나머지는 동(읍·면이면 "봉담읍 동화리"처럼 둘).
  let jibun = '';
  if (after.length && /^(산)?\d+(-\d+)?$/.test(after[after.length - 1])) jibun = after.pop();
  else if (after.length >= 2 && after[after.length - 2] === '산' && /^\d+(-\d+)?$/.test(after[after.length - 1])) {
    jibun = `산${after.pop()}`; after.pop();
  }
  const dong = after.join(' ');
  if (!dong) return null;
  return { regionCode: best.code, regionName: best.name, dong, jibun };
}

// 카카오 키워드 검색 문서들 → 분류가 "… > 아파트"인 것만(“아파트상가”·입출구 등은 뺀다), 같은 단지 중복 제거. 최대 limit개.
// 같은 지번에 1단지·2단지가 같이 있을 수 있어서(래미안대치팰리스) 중복 판단은 지역·동·지번·정규화 이름으로 한다.
export function toComplexResults(docs, limit = 10) {
  const out = [];
  const seen = new Set();
  (docs || []).forEach((d) => {
    if (out.length >= limit) return;
    if (!String(d?.category_name || '').split('>').map((x) => x.trim()).includes('아파트')) return;
    const parsed = parseKakaoAddress(d.address_name);
    const lat = parseFloat(d.y);
    const lng = parseFloat(d.x);
    if (!parsed || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    // "헬리오시티 101동"·"○○아파트 관리사무소"처럼 단지 안 시설 이름이면 단지 이름만, 끝의 "아파트"도 뗀다("헬리오시티아파트" → "헬리오시티").
    let name = String(d.place_name || '').replace(/\s+(\d+동|관리사무소|정문|후문|상가|경로당|어린이집)$/, '').trim();
    if (name.length > 4) name = name.replace(/\s*아파트$/, '');
    const id = `${parsed.regionCode}|${parsed.dong}|${parsed.jibun}|${normalizeComplexName(name)}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      name, address: d.address_name, road: d.road_address_name || '', lat, lng, ...parsed,
    });
  });
  return out;
}

const dongLike = (a, b) => {
  const x = String(a || '').trim();
  const y = String(b || '').trim();
  if (!x || !y) return false;
  return x === y || x.endsWith(` ${y}`) || y.endsWith(` ${x}`) || x.startsWith(`${y} `) || y.startsWith(`${x} `);
};

// 검색에서 고른 단지(target: {name, regionCode, dong, jibun})를 불러온 단지 목록(cands: mapComplexes 항목들)에서 찾는다.
// 우선순위: 같은 동 + 같은 지번(실거래 지번) > 같은 동 + 정규화 이름 같음 > 같은 동 + 이름 포함(후보가 하나일 때만)
// > 같은 지역 어디든 정규화 이름 같음(하나일 때만). 못 찾으면 null — 비슷한 이름을 억지로 고르지 않는다.
export function matchSearchedComplex(cands, target) {
  if (!target || !Array.isArray(cands) || !cands.length) return null;
  const inRegion = cands.filter((c) => c.regionCode === target.regionCode);
  const sameDong = inRegion.filter((c) => dongLike(c.dong, target.dong));
  const tj = String(target.jibun || '').trim();
  if (tj) {
    const byJibun = sameDong.filter((c) => String(c.jibun || '').trim() === tj);
    if (byJibun.length === 1) return byJibun[0];
    if (byJibun.length > 1) {
      const tn = normalizeComplexName(target.name);
      return byJibun.find((c) => normalizeComplexName(c.apt) === tn) || byJibun[0];
    }
  }
  const tn = normalizeComplexName(target.name);
  if (!tn) return null;
  const exact = sameDong.filter((c) => normalizeComplexName(c.apt) === tn);
  if (exact.length >= 1) return exact[0];
  const partial = sameDong.filter((c) => {
    const cn = normalizeComplexName(c.apt);
    return cn.length >= 2 && (cn.includes(tn) || tn.includes(cn));
  });
  if (partial.length === 1) return partial[0];
  const anywhere = inRegion.filter((c) => normalizeComplexName(c.apt) === tn);
  if (anywhere.length === 1) return anywhere[0];
  return null;
}

// 불러온 단지 목록 안에서 이름으로 바로 찾기(검색창 자동완성의 "불러온 지역" 부분). 띄어쓰기·대소문자 무시, 앞부분이 맞는 것 먼저.
export function localComplexMatches(complexes, query, limit = 5) {
  const q = normalizeComplexName(query);
  if (q.length < 2) return [];
  const hits = [];
  (complexes || []).forEach((c) => {
    const n = normalizeComplexName(c.apt);
    const i = n.indexOf(q);
    if (i >= 0) hits.push({ c, score: (i === 0 ? 0 : 1) + (c.latestPrice == null ? 0.5 : 0) });
  });
  hits.sort((a, b) => a.score - b.score || String(a.c.apt).length - String(b.c.apt).length);
  return hits.slice(0, limit).map((h) => h.c);
}

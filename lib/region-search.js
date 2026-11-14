// v238: 지도 탭 검색창의 "지역" 찾기 — 시·도, 시·군·구, 동 이름. 화면 요소 없는 순수 함수.
// 예전 왼쪽 패널 지역 검색은 시·도 이름만 걸러서 "강서구"를 치면 아무것도 안 나왔다.

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
// "서울특별시" → "서울", "경기도" → "경기", "전북특별자치도" → "전북"
export function sidoShort(sido) {
  const s = String(sido || '');
  const special = { 충청북도: '충북', 충청남도: '충남', 전라북도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남' };
  if (special[s]) return special[s];
  return s.replace(/(특별자치시|특별자치도|광역시|특별시|도)$/, '');
}

// groups: REGION_GROUPS([{ sido, items: [{ code, name }] }]), aggregates: SIDO_AGGREGATES([{ code, name, sido }])
// 돌려주는 값: [{ code, label, kind: 'sido' | 'sgg' }] — 정확히 같은 이름 → 이름이 검색어로 시작 → 포함 순, 최대 limit개.
export function searchRegions(groups, aggregates, query, limit = 8) {
  const q = norm(query);
  if (q.length < 2) return [];
  const out = [];
  const seen = new Set();
  const push = (code, label, kind, names) => {
    if (seen.has(code)) return;
    const ns = names.map(norm);
    let score = -1;
    if (ns.some((n) => n === q)) score = 0;
    else if (ns.some((n) => n.startsWith(q))) score = 1;
    else if (ns.some((n) => n.includes(q))) score = 2;
    if (score < 0) return;
    seen.add(code);
    out.push({ code, label, kind, score });
  };
  (aggregates || []).forEach((a) => {
    const short = sidoShort(a.sido);
    push(a.code, `${short} 전체`, 'sido', [a.sido, short, `${short}전체`]);
  });
  (groups || []).forEach((g) => {
    const short = sidoShort(g.sido);
    (g.items || []).forEach((it) => {
      const last = String(it.name).split(/\s+/).pop(); // "성남시 분당구" → "분당구"
      const bare = last.replace(/(시|군|구)$/, ''); // "분당", "강서"
      const names = [it.name, last, `${short}${it.name}`, `${g.sido}${it.name}`, `${short}${last}`];
      if (bare.length >= 2) names.push(bare, `${short}${bare}`);
      // "수원시 영통구" → "수원영통"(시·구 글자를 빼고 줄여 쓴 경우)
      const stripped = String(it.name).split(/\s+/).map((t) => t.replace(/(시|군|구)$/, '')).join('');
      if (stripped.length >= 2) names.push(stripped);
      push(it.code, `${short} ${it.name}`, 'sgg', names);
    });
  });
  return out.sort((a, b) => a.score - b.score || (a.kind === 'sido' ? -1 : 0) - (b.kind === 'sido' ? -1 : 0)).slice(0, limit)
    .map(({ score, ...rest }) => rest);
}

// complexes: 불러온 단지 [{ regionCode, dong }]. 동 이름이 검색어를 포함하는 (지역, 동) 쌍, 최대 limit개.
export function searchDongs(complexes, query, limit = 5) {
  const q = norm(query);
  if (q.length < 2) return [];
  const out = [];
  const seen = new Set();
  (complexes || []).forEach((c) => {
    if (!c?.dong || !c?.regionCode) return;
    const d = norm(c.dong);
    if (!d.includes(q) && !(q.endsWith('동') && d === q)) return;
    const k = `${c.regionCode}|${c.dong}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ regionCode: c.regionCode, dong: c.dong, exact: d === q || d === `${q}동` });
  });
  return out.sort((a, b) => Number(b.exact) - Number(a.exact)).slice(0, limit);
}

// "목록만" 단지(단지 목록에는 있는데 이번 조회 기간에 거래가 없는 단지) 중에서,
// 사실은 거래가 있는 단지와 이름만 다르게 적힌 같은 단지가 얼마나 되는지 가늠하기 위한 도구.
//
// 단지 목록(K-apt)과 실거래 데이터는 이름을 각자 적어서 "목동신시가지아파트7단지"와
// "목동신시가지7단지"처럼 달라질 수 있다. 이 파일은 합치지 않고 "비슷해 보이는 후보"만 찾아서
// 화면에 보여준다 — 실제 이름 패턴을 눈으로 확인한 뒤에 합치는 규칙을 정하기 위해서다.

const GENERIC = /아파트|단지|apt/gi;

export function normalizeComplexName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[\s\-_.()[\]·,/]/g, '')
    .replace(GENERIC, '');
}

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i += 1) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

// 0~1. 두 글자씩 끊어 겹치는 비율(Dice).
export function nameSimilarity(a, b) {
  const x = normalizeComplexName(a);
  const y = normalizeComplexName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const gx = bigrams(x);
  const gy = bigrams(y);
  let inter = 0;
  gx.forEach((n, g) => { inter += Math.min(n, gy.get(g) || 0); });
  const total = Math.max(x.length - 1, 0) + Math.max(y.length - 1, 0);
  return total ? (2 * inter) / total : 0;
}

// 이름에 들어 있는 숫자들("7단지", "2차", "101동" 등)을 순서대로 뽑는다.
const digitsOf = (s) => (s.match(/\d+/g) || []).join('|');

// 한쪽이 다른 쪽을 품고 있거나(짧은 쪽이 3글자 이상) 글자 겹침이 높으면 "비슷하다"고 본다.
// 단, 이름 속 숫자가 서로 다르면(6단지 vs 7단지, 1차 vs 2차) 다른 단지로 본다 — 이름이 거의 같아도
// 번호만 다른 단지가 많아서, 이걸 같다고 보면 중복이 실제보다 많아 보인다.
export function looksSimilar(a, b, threshold = 0.6) {
  const x = normalizeComplexName(a);
  const y = normalizeComplexName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const dx = digitsOf(x);
  const dy = digitsOf(y);
  if (dx !== dy) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 3 && long.includes(short)) return true;
  return nameSimilarity(a, b) >= threshold;
}

// complexes: [{ regionCode, dong, apt, latestPrice }] — latestPrice가 있으면 "거래 있음".
// 반환: 거래 없는 단지(목록만)를 세 갈래로 나눈 개수와 같은 동 후보 예시.
export function classifyListOnly(complexes, sampleLimit = 12) {
  const traded = [];
  const listOnly = [];
  (complexes || []).forEach((c) => (c.latestPrice != null ? traded : listOnly).push(c));
  const byRegion = new Map();
  traded.forEach((t) => {
    if (!byRegion.has(t.regionCode)) byRegion.set(t.regionCode, []);
    byRegion.get(t.regionCode).push(t);
  });
  const out = { listOnly: listOnly.length, traded: traded.length, sameDong: 0, otherDong: 0, none: 0, samples: [] };
  listOnly.forEach((c) => {
    const pool = byRegion.get(c.regionCode) || [];
    const same = pool.find((t) => t.dong === c.dong && looksSimilar(c.apt, t.apt));
    if (same) {
      out.sameDong += 1;
      if (out.samples.length < sampleLimit) out.samples.push({ list: c.apt, trade: same.apt, dong: c.dong });
      return;
    }
    if (pool.some((t) => t.dong !== c.dong && looksSimilar(c.apt, t.apt))) out.otherDong += 1;
    else out.none += 1;
  });
  return out;
}

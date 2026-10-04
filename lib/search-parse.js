import { REGION_GROUPS, SIDO_AGGREGATES } from './regions';

// 헤더 검색창 문장("해운대 84 8억 이하")을 조건으로 풀어주는 순수 함수 모음.
// 화면 상태는 건드리지 않고 "무엇을 알아들었는지"만 돌려준다 — 적용은 page.jsx가 한다.
// 못 알아들은 것·애매한 것은 억지로 고르지 않고 그대로 알려준다.

const SIDO_ALIASES = [
  ['서울', '서울특별시'], ['부산', '부산광역시'], ['대구', '대구광역시'], ['인천', '인천광역시'],
  ['광주', '광주광역시'], ['대전', '대전광역시'], ['울산', '울산광역시'], ['세종', '세종특별자치시'],
  ['경기', '경기도'], ['강원', '강원특별자치도'], ['충북', '충청북도'], ['충남', '충청남도'],
  ['전북', '전북특별자치도'], ['전남', '전라남도'], ['경북', '경상북도'], ['경남', '경상남도'],
  ['제주', '제주특별자치도'],
];
// 긴 이름부터 비교해야 "서울특별시"가 "서울"보다 먼저 잡힌다.
const SIDO_NAME_LIST = SIDO_ALIASES
  .flatMap(([short, full]) => [[full, full], [short, full]])
  .sort((a, b) => b[0].length - a[0].length);
const SIDO_SHORT_BY_FULL = Object.fromEntries(SIDO_ALIASES.map(([s, f]) => [f, s]));

// 앱에 있는 "정확한 전용면적" 버튼 값과 ±2㎡ 허용 범위.
const EXACT_SQM = [59, 74, 84, 101];

const normalizeName = (s) => {
  const t = s.replace(/\s+/g, '');
  const n = t.replace(/(구|시|군)$/, '');
  return n.length >= 2 ? n : t;
};

// 지역 색인: 이름 전체, 띄어쓰기로 나눈 각 부분("성남시", "분당구")을 모두 검색 키로 쓴다.
const REGION_INDEX = REGION_GROUPS.flatMap((g) => g.items.map((it) => {
  const keys = new Set();
  const full = it.name.replace(/\s+/g, '');
  keys.add(full); keys.add(normalizeName(it.name));
  it.name.split(/\s+/).forEach((part) => { keys.add(part); keys.add(normalizeName(part)); });
  return { sido: g.sido, name: it.name, code: it.code, keys };
}));

function findRegionCandidates(token, sidoHint) {
  const t = token.replace(/\s+/g, '');
  if (t.length < 2) return [];
  const nt = normalizeName(t);
  return REGION_INDEX.filter((r) => (
    (!sidoHint || r.sido === sidoHint) && (r.keys.has(t) || (nt.length >= 2 && r.keys.has(nt)))
  ));
}

const PRICE_DIR = [
  [/^(이하|이내|아래|미만|까지)/, 'max'],
  [/^(이상|초과|넘는|부터)/, 'min'],
];

function readDirection(text) {
  const rest = text.trimStart();
  for (const [re, dir] of PRICE_DIR) {
    const m = rest.match(re);
    if (m) return { dir, consumed: text.length - rest.length + m[0].length };
  }
  return { dir: null, consumed: 0 };
}

// 금액 표현 → 억 단위 숫자. "8억", "8.5억", "8억 5천", "8억 2000만", "5천만원", "85000만원".
function extractPrices(input) {
  let w = input;
  const found = [];
  const patterns = [
    {
      re: /(\d+(?:\.\d+)?)\s*억(?:\s*(\d+)\s*천(?:\s*만원?)?)?(?:\s*(\d{1,4})\s*만원?)?/,
      value: (m) => parseFloat(m[1]) + (m[2] ? (parseInt(m[2], 10) * 1000) / 10000 : 0) + (m[3] ? parseInt(m[3], 10) / 10000 : 0),
    },
    { re: /(\d+)\s*천\s*만?원?/, value: (m) => (parseInt(m[1], 10) * 1000) / 10000 },
    { re: /(\d[\d,]{2,6})\s*만\s*원?/, value: (m) => parseInt(m[1].replace(/,/g, ''), 10) / 10000 },
  ];
  for (const { re, value } of patterns) {
    for (;;) {
      const m = w.match(re);
      if (!m) break;
      const end = m.index + m[0].length;
      const { dir, consumed } = readDirection(w.slice(end));
      found.push({ eok: Math.round(value(m) * 10000) / 10000, dir });
      w = `${w.slice(0, m.index)} ${w.slice(end + consumed)}`;
    }
  }
  return { prices: found, rest: w };
}

function extractArea(input) {
  let w = input;
  let sqm = null;
  let pyeong = null;
  const sqmRe = /(\d{2,3})\s*(?:㎡|m²|m2|M2|제곱미터|제곱|평방)/;
  const jeonyongRe = /전용\s*(\d{2,3})/;
  const pyeongRe = /(\d{1,2})\s*평\s*(?:형|대)?/;
  let m = w.match(sqmRe) || w.match(jeonyongRe);
  if (m) { sqm = parseInt(m[1], 10); w = `${w.slice(0, m.index)} ${w.slice(m.index + m[0].length)}`; }
  m = w.match(pyeongRe);
  if (m) { pyeong = parseInt(m[1], 10); w = `${w.slice(0, m.index)} ${w.slice(m.index + m[0].length)}`; }
  // 단독 숫자는 앱에 있는 정확면적 값(59/74/84/101)일 때만 면적으로 본다 — "래미안 2" 같은 이름을 건드리지 않게.
  if (sqm == null && pyeong == null) {
    const bare = w.match(/(?:^|\s)(59|74|84|101)(?=\s|$)/);
    if (bare) { sqm = parseInt(bare[1], 10); w = `${w.slice(0, bare.index)} ${w.slice(bare.index + bare[0].length)}`; }
  }
  return { sqm, pyeong, rest: w };
}

const bucketOfPyeong = (p) => (p < 20 ? 'u20' : p < 30 ? '20s' : p < 40 ? '30s' : p < 50 ? '40s' : '50p');
const BUCKET_LABEL = { u20: '20평 미만', '20s': '20평대', '30s': '30평대', '40s': '40평대', '50p': '50평 이상' };

function resolveUnitSize({ sqm, pyeong }) {
  if (sqm != null) {
    const near = EXACT_SQM.find((x) => Math.abs(x - sqm) <= 2);
    if (near) {
      return {
        value: `sqm${near}`, label: `${near}㎡`,
        note: near === sqm ? null : `${sqm}㎡는 가장 가까운 ${near}㎡(±2㎡)로 봤어요.`,
      };
    }
    const bucket = bucketOfPyeong(sqm / 3.3058);
    return {
      value: bucket, label: `${BUCKET_LABEL[bucket]}(전용)`,
      note: `${sqm}㎡는 정확 비교 면적(59·74·84·101)에 없어서 ${BUCKET_LABEL[bucket]}(전용 기준)로 봤어요.`,
    };
  }
  if (pyeong != null) {
    const bucket = bucketOfPyeong(pyeong);
    return {
      value: bucket, label: `${BUCKET_LABEL[bucket]}(전용)`,
      note: `"${pyeong}평"은 앱의 전용면적 기준 ${BUCKET_LABEL[bucket]}로 적용했어요. 흔히 말하는 공급 평형과 다를 수 있어서, 84처럼 ㎡로 쓰면 더 정확해요.`,
    };
  }
  return null;
}

const DEAL_WORDS = [
  [/전세가율/, 'ratio', '전세가율'],
  [/분양권(?:전매)?/, 'silv', '분양권'],
  [/전월세|전세|월세/, 'rent', '전월세'],
  [/매매/, 'trade', '매매'],
];

function extractDeal(input) {
  let w = input;
  let deal = null;
  for (const [re, value, label] of DEAL_WORDS) {
    const m = w.match(re);
    if (m) { deal = { value, label }; w = `${w.slice(0, m.index)} ${w.slice(m.index + m[0].length)}`; break; }
  }
  return { deal, rest: w };
}

export function parseSearchQuery(raw) {
  const result = {
    raw,
    region: null, // { codes, label, kind: 'region' | 'sido', sido }
    regionAmbiguous: null, // { name, sidos }
    dealType: null, dealLabel: null,
    unitSize: null, // { value, label, note }
    maxPriceEok: null,
    unsupported: [],
    notes: [],
    complexQuery: '',
  };

  let w = raw;
  const deal = extractDeal(w); w = deal.rest;
  if (deal.deal) { result.dealType = deal.deal.value; result.dealLabel = deal.deal.label; }

  const price = extractPrices(w); w = price.rest;
  if (price.prices.length) {
    const maxes = price.prices.filter((p) => p.dir === 'max');
    const mins = price.prices.filter((p) => p.dir === 'min');
    const bare = price.prices.filter((p) => p.dir == null);
    if (maxes.length) result.maxPriceEok = maxes[maxes.length - 1].eok;
    else if (bare.length) {
      result.maxPriceEok = Math.max(...bare.map((p) => p.eok));
      result.notes.push('가격만 적어서 "이하"로 봤어요.');
    }
    if (mins.length) result.unsupported.push('가격 "이상" 조건은 아직 지원하지 않아요 (이하만 적용돼요).');
  }

  const area = extractArea(w); w = area.rest;
  result.unitSize = resolveUnitSize(area);
  if (result.unitSize?.note) result.notes.push(result.unitSize.note);

  // 남은 글자에서 지역 → 나머지는 단지명으로 본다.
  const tokens = w.split(/[\s,]+/).filter(Boolean).filter((t) => t !== '전체' && t !== '전국');
  let sidoHint = null;
  const used = new Set();
  const matches = []; // 지역으로 읽힌 단어들: { idx, cands }
  const sidoOfName = (name) => SIDO_NAME_LIST.find(([n]) => n === name)?.[1] || null;

  tokens.forEach((tok, i) => {
    // 시·도 이름 그 자체 ("부산", "경기도")
    const exactSido = sidoOfName(tok);
    if (exactSido && !sidoHint) { sidoHint = exactSido; used.add(i); return; }
    // 시·도 + 지역이 붙어 있는 경우 ("부산강서구")
    for (const [name, full] of SIDO_NAME_LIST) {
      if (tok.length > name.length && tok.startsWith(name)) {
        const rest = tok.slice(name.length);
        if (findRegionCandidates(rest, full).length) { sidoHint = full; tokens[i] = rest; break; }
      }
    }
    const cands = findRegionCandidates(tokens[i], sidoHint);
    if (cands.length) { matches.push({ idx: i, cands }); used.add(i); }
  });

  // 지역 단어가 여럿이면: 앞 지역 안의 구로 읽히면 좁히고("성남 분당"), 아예 다른 지역이면 같이 고른다("해운대 수영").
  let regionSet = null;
  let ambiguous = null;
  for (const mt of matches) {
    const sidos = [...new Set(mt.cands.map((c) => c.sido))];
    if (sidos.length > 1) { ambiguous = { name: tokens[mt.idx], sidos }; break; }
    if (!regionSet) { regionSet = [...mt.cands]; continue; }
    const inter = regionSet.filter((r) => mt.cands.some((c) => c.code === r.code));
    regionSet = inter.length
      ? inter
      : [...regionSet, ...mt.cands.filter((c) => !regionSet.some((r) => r.code === c.code))];
  }

  if (ambiguous) {
    result.regionAmbiguous = {
      name: ambiguous.name,
      sidos: ambiguous.sidos.map((sd) => SIDO_SHORT_BY_FULL[sd] || sd),
    };
  } else if (regionSet && regionSet.length) {
    // "수원"처럼 도시 전체 항목(수원시)과 그 구 항목들이 같이 걸리면, 거래가 두 번 세어지지 않게 도시 전체 하나만 쓴다.
    const wholes = regionSet.filter((c) => !c.name.includes(' ')
      && regionSet.some((o) => o !== c && o.name.startsWith(`${c.name} `)));
    regionSet = regionSet.filter((c) => !wholes.some((wh) => c.name.startsWith(`${wh.name} `)));
    const sidosInSet = [...new Set(regionSet.map((c) => c.sido))];
    const sidoPrefix = sidosInSet.length === 1 ? `${SIDO_SHORT_BY_FULL[sidosInSet[0]] || sidosInSet[0]} ` : '';
    result.region = {
      codes: regionSet.map((c) => c.code),
      label: `${sidoPrefix}${regionSet.map((c) => c.name).join(', ')}`,
      kind: 'region',
      sido: sidosInSet[0],
    };
  } else if (sidoHint) {
    const agg = SIDO_AGGREGATES.find((a) => a.sido === sidoHint);
    if (agg) result.region = { codes: [agg.code], sido: sidoHint, label: agg.name, kind: 'sido' };
  }

  result.complexQuery = tokens
    .filter((_, i) => !used.has(i))
    .join(' ')
    .replace(/(이하|이내|아래|미만|까지|이상|초과)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return result;
}

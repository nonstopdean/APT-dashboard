import { publicError } from '../../../lib/safe-error';
import { REGION_GROUPS } from '../../../lib/regions';
import { kvReady, kvGet, kvMSet } from '../../../lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

// 구(시·군·구) 하나의 단지별 세대수(v212, 세대수 조건용). 한국부동산원 "공동주택 단지 식별정보"를
// 주소(시·도 + 구)로 한 번에 받아 Upstash에 저장해 두고 다시 쓴다 — 국토부 기본정보는 단지마다
// 한 번씩 불러야 해서(송파만 약 360번) 방문자마다 부르기엔 무겁다. 빌라 등 작은 단지는 빼고 20세대 이상만.
// 응답 행: [동, 세대수, 사용승인연도, 이름1|이름2|이름3]
const KEY_PREFIX = 'hh:v1:';
const MIN_HOUSEHOLDS = 20;
const PER_PAGE = 1000;
const MAX_PAGES = 12;

function regionPrefix(code) {
  for (const g of REGION_GROUPS) {
    const it = g.items.find((x) => x.code === code);
    if (it) return `${g.sido} ${it.name}`;
  }
  return null;
}

async function fetchRows(serviceKey, prefix) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `https://api.odcloud.kr/api/15106861/v1/uddi:46a20910-19aa-462e-ba09-e897b77d0e76`
      + `?page=${page}&perPage=${PER_PAGE}&returnType=JSON`
      + `&cond[주소::LIKE]=${encodeURIComponent(prefix)}`
      + `&serviceKey=${encodeURIComponent(serviceKey)}`;
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('단지 식별정보를 불러오지 못했습니다.');
    // eslint-disable-next-line no-await-in-loop
    const json = await res.json();
    const rows = Array.isArray(json?.data) ? json.data : [];
    rows.forEach((r) => {
      const address = String(r['주소'] || '');
      if (!address.startsWith(`${prefix} `)) return;
      const households = parseInt(String(r['세대수'] ?? '').replace(/[^0-9]/g, ''), 10);
      if (!Number.isFinite(households) || households < MIN_HOUSEHOLDS) return;
      const dong = address.slice(prefix.length + 1).split(/\s+/)[0] || '';
      const names = [r['단지명_공시가격'], r['단지명_건축물대장'], r['단지명_도로명주소']]
        .filter(Boolean).map((n) => String(n).trim());
      if (!dong || names.length === 0) return;
      const year = parseInt(String(r['사용승인일'] || '').slice(0, 4), 10) || null;
      out.push([dong, households, year, [...new Set(names)].join('|')]);
    });
    const total = Number(json?.totalCount ?? json?.matchCount ?? 0);
    if (rows.length < PER_PAGE || (total && page * PER_PAGE >= total)) break;
  }
  return out;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = (searchParams.get('code') || '').trim();
  const prefix = /^\d{5}$/.test(code) ? regionPrefix(code) : null;
  if (!prefix) return Response.json({ error: '올바른 구 코드가 필요합니다.' }, { status: 400 });

  const serviceKey = (process.env.MOLIT_SERVICE_KEY || '').trim();
  if (!serviceKey) {
    return Response.json({ error: '서버에 MOLIT_SERVICE_KEY 환경변수가 설정되지 않았습니다.' }, { status: 500 });
  }

  try {
    if (kvReady()) {
      const cached = await kvGet(`${KEY_PREFIX}${code}`);
      if (cached && Array.isArray(cached.rows)) return Response.json({ rows: cached.rows, cached: true });
    }
    const rows = await fetchRows(serviceKey, prefix);
    // 0건이면 저장하지 않는다(일시적인 오류일 수 있으므로 다음에 다시 받게).
    if (rows.length && kvReady()) await kvMSet([[`${KEY_PREFIX}${code}`, { rows, at: Date.now() }]]);
    return Response.json({ rows, cached: false });
  } catch (e) {
    return Response.json({ error: publicError(e, '세대수 정보를 불러오지 못했습니다.') }, { status: 500 });
  }
}

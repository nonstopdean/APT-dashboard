import { pickDongCenter } from '../../../lib/complex-search';
import { REGION_GROUPS } from '../../../lib/regions';
import { kvReady, kvMGet, kvMSet } from '../../../lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

// v259: 법정동 중심 좌표. 지도 동 경계 자료(2018, 행정동)와 실거래 동 이름(법정동)이 전혀 다르면(김해 율하동 ↔ 장유1동)
// 주변 구 단지 핀을 못 놓았다. 그런 동만 화면이 모아 물어보면 카카오 주소 검색으로 찾아 저장소에 영구 보관한다.
// GET ?code=48250&dongs=율하동,대청동 (최대 25개) → { centers: { 율하동: { lat, lng } | null } }
const KEY = (code, dong) => `dongc:${code}|${dong}`;
const sidoOf = (code) => REGION_GROUPS.find((g) => g.items.some((it) => it.code === code));

export async function GET(request) {
  const restKey = (process.env.KAKAO_REST_API_KEY || '').trim();
  if (!restKey) return Response.json({ error: '서버 설정이 필요해요.' }, { status: 503 });
  const { searchParams } = new URL(request.url);
  const code = String(searchParams.get('code') || '').trim();
  const group = sidoOf(code);
  if (!/^\d{5}$/.test(code) || !group) return Response.json({ error: '지역 코드가 맞지 않아요.' }, { status: 400 });
  const regionName = group.items.find((it) => it.code === code)?.name || '';
  const dongs = [...new Set(String(searchParams.get('dongs') || '').split(',')
    .map((d) => d.trim()).filter((d) => /^[가-힣0-9·\s]{1,20}$/.test(d)))].slice(0, 25);
  if (!dongs.length) return Response.json({ centers: {} });

  const centers = {};
  let cached = {};
  if (kvReady()) {
    try { cached = await kvMGet(dongs.map((d) => KEY(code, d))); } catch (e) { cached = {}; }
  }
  const todo = [];
  dongs.forEach((d) => {
    const v = cached[KEY(code, d)];
    if (v && (v.none || (Number.isFinite(v.lat) && Number.isFinite(v.lng)))) centers[d] = v.none ? null : { lat: v.lat, lng: v.lng };
    else todo.push(d);
  });

  const writes = [];
  await Promise.all(todo.map(async (d) => {
    try {
      const q = `${group.sido} ${regionName} ${d}`;
      const res = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(q)}&size=30`, {
        headers: { Authorization: `KakaoAK ${restKey}` }, cache: 'no-store',
      });
      if (!res.ok) { centers[d] = null; return; } // 일시 오류는 저장하지 않는다(다음에 다시)
      const hit = pickDongCenter((await res.json())?.documents, code, d);
      centers[d] = hit;
      writes.push([KEY(code, d), hit || { none: 1 }]);
    } catch (e) {
      centers[d] = null;
    }
  }));
  if (writes.length && kvReady()) {
    try { await kvMSet(writes); } catch (e) { /* 저장 실패해도 응답은 준다 */ }
  }
  return Response.json({ centers }, { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' } });
}

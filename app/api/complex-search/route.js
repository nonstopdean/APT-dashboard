import { toComplexResults, toDongResults, dongQueriesOf } from '../../../lib/complex-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

// v229: 전국 단지 이름 검색. 카카오 로컬 키워드 검색(이미 쓰는 KAKAO_REST_API_KEY)에서 "아파트" 분류만 골라
// 우리 지역 코드·동·지번으로 바꿔 돌려준다(lib/complex-search.js). 같은 검색어는 CDN이 하루 동안 재사용한다.
export async function GET(request) {
  const restKey = (process.env.KAKAO_REST_API_KEY || '').trim();
  if (!restKey) return Response.json({ error: '단지 검색을 쓸 수 없어요(서버 설정 필요).' }, { status: 503 });

  const { searchParams } = new URL(request.url);
  const q = String(searchParams.get('q') || '').trim().slice(0, 40);
  if (q.replace(/\s+/g, '').length < 2) return Response.json({ results: [] });

  try {
    const docs = [];
    for (let page = 1; page <= 2; page += 1) {
      const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q)}&size=15&page=${page}`;
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(url, { headers: { Authorization: `KakaoAK ${restKey}` }, cache: 'no-store' });
      if (!res.ok) {
        if (page === 1) return Response.json({ error: '단지 검색에 실패했어요. 잠시 뒤 다시 시도해주세요.' }, { status: 502 });
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      const json = await res.json();
      docs.push(...(json?.documents || []));
      // 아파트가 충분히 나왔거나 마지막 쪽이면 그만 받는다.
      if (json?.meta?.is_end || toComplexResults(docs, 10).length >= 6) break;
    }
    const results = toComplexResults(docs, 10);
    // v240: 동 이름이면 카카오 주소 검색도 — 지도에 아직 안 불러온 지역의 동도 찾게. 실패해도 단지 결과는 그대로 돌려준다.
    let dongs = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const dq of dongQueriesOf(q)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(dq)}&size=30`, {
          headers: { Authorization: `KakaoAK ${restKey}` }, cache: 'no-store',
        });
        // eslint-disable-next-line no-await-in-loop
        if (res.ok) dongs = toDongResults((await res.json())?.documents, 8);
      } catch (e) { dongs = []; }
      if (dongs.length) break;
    }
    return Response.json({ results, dongs }, { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' } });
  } catch (e) {
    return Response.json({ error: '단지 검색에 실패했어요. 잠시 뒤 다시 시도해주세요.' }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

// 카카오 로컬 카테고리 코드: 대형마트/카페/학원/병원. 이미 보유한 REST API 키를 재사용한다.
const CATEGORIES = [
  { code: 'MT1', label: '대형마트' },
  { code: 'CE7', label: '카페' },
  { code: 'AC5', label: '학원' },
  { code: 'HP8', label: '병원' },
];

export async function GET(request) {
  const restKey = (process.env.KAKAO_REST_API_KEY || '').trim();
  if (!restKey) return Response.json({ error: 'KAKAO_REST_API_KEY 환경변수가 없습니다.' }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get('lat'));
  const lng = parseFloat(searchParams.get('lng'));
  const radius = parseInt(searchParams.get('radius') || '500', 10);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: 'lat/lng가 필요합니다.' }, { status: 400 });
  }

  try {
    const results = await Promise.all(CATEGORIES.map(async ({ code, label }) => {
      const url = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=${code}&x=${lng}&y=${lat}&radius=${radius}&size=15`;
      const res = await fetch(url, { headers: { Authorization: `KakaoAK ${restKey}` } });
      if (!res.ok) return { code, label, count: null };
      const json = await res.json();
      // 카카오는 한 번에 최대 15개(size)만 주지만 total_count로 반경 내 총 개수를 알려준다.
      const total = json?.meta?.total_count ?? null;
      const names = (json?.documents || []).slice(0, 5).map((d) => d.place_name);
      return { code, label, count: total, sample: names };
    }));
    return Response.json({ radius, results });
  } catch (e) {
    return Response.json({ error: '주변시설 조회에 실패했습니다.' }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

// 공공데이터포털(data.go.kr) "전국초중등학교위치표준데이터" — NEIS 학교기본정보와 달리
// 위도/경도를 직접 제공해서 지도 마커로 바로 찍을 수 있다. 시/도 단위로 한 번에 받아와서
// 캐시해두고, 화면 범위(viewport)는 클라이언트에서 걸러낸다 (지하철역 레이어와 같은 방식).
export async function GET(request) {
  const apiKey = (process.env.SCHOOL_LOCATION_API_KEY || '').trim();
  if (!apiKey) {
    return Response.json({ error: '서버에 SCHOOL_LOCATION_API_KEY 환경변수가 설정되지 않았습니다.' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const sido = (searchParams.get('sido') || '').trim(); // 예: "서울특별시"
  if (!sido) {
    return Response.json({ error: 'sido가 필요합니다.' }, { status: 400 });
  }

  try {
    const schools = [];
    let pageNo = 1;
    const numOfRows = 1000;
    // 한 시/도에 학교가 많아도(서울 1,300여 개 등) 넉넉히 받아오되, 과도한 호출은 막는다.
    for (let i = 0; i < 5; i += 1) {
      const url = `https://api.data.go.kr/openapi/tn_pubr_public_elesch_mskul_lc_api`
        + `?serviceKey=${apiKey}&pageNo=${pageNo}&numOfRows=${numOfRows}&type=json`
        + `&lnmadr=${encodeURIComponent(sido)}`;
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(url);
      // eslint-disable-next-line no-await-in-loop
      const json = await res.json();
      const items = json?.response?.body?.items;
      const rows = Array.isArray(items) ? items : (items?.item ? (Array.isArray(items.item) ? items.item : [items.item]) : []);
      if (rows.length === 0) break;
      rows.forEach((r) => {
        const lat = parseFloat(r.latitude);
        const lng = parseFloat(r.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        schools.push({
          name: r.schoolNm, kind: r.schoolSe, lat, lng,
          address: r.lnmadr || r.rdnmadr,
        });
      });
      const totalCount = parseInt(json?.response?.body?.totalCount, 10) || 0;
      if (schools.length >= totalCount || rows.length < numOfRows) break;
      pageNo += 1;
    }
    return Response.json({ schools });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

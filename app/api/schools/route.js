export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const keyword = (searchParams.get('keyword') || '').trim();

  const apiKey = (process.env.NEIS_API_KEY || '').trim();
  if (!apiKey) {
    return Response.json({ error: '서버에 NEIS_API_KEY 환경변수가 설정되지 않았습니다.' }, { status: 500 });
  }
  if (!keyword) {
    return Response.json({ error: 'keyword가 필요합니다.' }, { status: 400 });
  }

  // 동 이름 뒤에 "동/가"가 붙어있으면 떼고, 학교 이름 검색에 쓸 핵심 키워드만 남긴다
  // (예: "역삼동" -> "역삼", 많은 초등학교가 동 이름을 그대로 따서 지어져 있다).
  const core = keyword.replace(/\d*(동|가)$/, '').trim() || keyword;

  const url = `https://open.neis.go.kr/hub/schoolInfo`
    + `?KEY=${encodeURIComponent(apiKey)}&Type=json&pIndex=1&pSize=30`
    + `&SCHUL_NM=${encodeURIComponent(core)}`;

  try {
    const res = await fetch(url);
    const json = await res.json();
    const rows = json?.schoolInfo?.[1]?.row || [];
    const schools = rows
      .filter((r) => ['초등학교', '중학교'].includes(r.SCHUL_KND_SC_NM))
      .map((r) => ({
        name: r.SCHUL_NM,
        kind: r.SCHUL_KND_SC_NM,
        address: r.ORG_RDNMA,
        foundType: r.FOND_SC_NM,
      }));
    return Response.json({ schools });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

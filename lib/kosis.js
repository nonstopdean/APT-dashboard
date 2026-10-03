// KOSIS(국가통계포털) "주민등록인구(시도/시/군/구)" 통계표. 시/도 단위 코드로 조회한다.
const SIDO_KOSIS_CODES = {
  전국: '00', 서울: '11', 부산: '26', 대구: '27', 인천: '28', 광주: '29', 대전: '30',
  울산: '31', 세종: '36', 경기: '41', 강원: '51', 충북: '43', 충남: '44',
  전북: '52', 전남: '46', 경북: '47', 경남: '48', 제주: '50',
};

export function sidoToKosisCode(sidoShortName) {
  return SIDO_KOSIS_CODES[sidoShortName] || null;
}

// 국내인구이동통계(시도별 전입/전출 등). 항목 코드(T10/T20/...)가 무엇을 뜻하는지 미리 단정하지 않고,
// KOSIS 응답이 같이 주는 ITM_NM(항목명)을 그대로 써서 화면에 보여준다 — 코드 의미를 추측하다 틀리는 걸 막는다.
export async function fetchKosisMigration(apiKey, sidoShortName, monthsBack = 24) {
  const code = sidoToKosisCode(sidoShortName);
  if (!code) return [];

  const url = `https://kosis.kr/openapi/Param/statisticsParameterData.do`
    + `?method=getList&apiKey=${encodeURIComponent(apiKey)}`
    + `&itmId=T10+T20+T25+T30+T31+T32+T40+T50+&objL1=${code}+&objL2=&objL3=&objL4=&objL5=&objL6=&objL7=&objL8=`
    + `&format=json&jsonVD=Y&prdSe=M&newEstPrdCnt=${monthsBack}&orgId=101&tblId=DT_1B26001_A01`;

  const res = await fetch(url);
  const json = await res.json();
  if (!Array.isArray(json)) {
    throw new Error(json?.errMsg || 'KOSIS 응답 오류');
  }
  return json
    .map((r) => ({
      ym: r.PRD_DE, itmId: r.ITM_ID, itmName: r.ITM_NM, value: parseInt(r.DT, 10),
    }))
    .filter((r) => Number.isFinite(r.value))
    .sort((a, b) => a.ym.localeCompare(b.ym));
}

export async function fetchKosisPopulation(apiKey, sidoShortName, monthsBack = 24) {
  const code = sidoToKosisCode(sidoShortName);
  if (!code) return [];

  const url = `https://kosis.kr/openapi/Param/statisticsParameterData.do`
    + `?method=getList&apiKey=${encodeURIComponent(apiKey)}`
    + `&itmId=T20+&objL1=${code}+&objL2=&objL3=&objL4=&objL5=&objL6=&objL7=&objL8=`
    + `&format=json&jsonVD=Y&prdSe=M&newEstPrdCnt=${monthsBack}&orgId=101&tblId=DT_1YL20651E`;

  const res = await fetch(url);
  const json = await res.json();
  if (!Array.isArray(json)) {
    // KOSIS는 오류 시 배열이 아니라 {err, errMsg} 형태의 객체를 준다.
    throw new Error(json?.errMsg || 'KOSIS 응답 오류');
  }
  return json
    .map((r) => ({ ym: r.PRD_DE, population: parseInt(r.DT, 10) }))
    .filter((r) => Number.isFinite(r.population))
    .sort((a, b) => a.ym.localeCompare(b.ym));
}

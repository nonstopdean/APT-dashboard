const RONE_BASE = 'https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do';

// v232: 지역 구분(CLS_ID) 없이 한 번에 모든 지역의 값을 받는다(지도 말풍선용). 12시간 저장해 쓴다.
// → [{ clsId, ym, value(만원), name }]
export async function fetchRoneAllRegions({ key, statblId, itmId, startYm, endYm }) {
  const url = `${RONE_BASE}?STATBL_ID=${statblId}&DTACYCLE_CD=MM`
    + `&ITM_ID=${itmId}&START_WRTTIME=${startYm}&END_WRTTIME=${endYm}`
    + `&pIndex=1&pSize=1000&KEY=${encodeURIComponent(key)}&Type=json`;
  const res = await fetch(url, { next: { revalidate: 43200 } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error('R-ONE 응답을 해석할 수 없습니다 (JSON 파싱 실패)'); }
  if (json.RESULT) throw new Error(json.RESULT.MESSAGE || `오류: ${json.RESULT.CODE}`);
  const blocks = json.SttsApiTblData || [];
  const rows = blocks.find((b) => b.row)?.row || [];
  return rows.map((r) => ({
    clsId: String(r.CLS_ID),
    ym: r.WRTTIME_IDTFR_ID,
    value: r.UI_NM === '천원' ? Number(r.DTA_VAL) / 10 : Number(r.DTA_VAL),
    name: r.CLS_FULLNM || r.CLS_NM,
  }));
}

export async function fetchRoneSeries({ key, statblId, itmId, clsId, startYm, endYm }) {
  const url = `${RONE_BASE}?STATBL_ID=${statblId}&DTACYCLE_CD=MM&CLS_ID=${clsId}`
    + `&ITM_ID=${itmId}&START_WRTTIME=${startYm}&END_WRTTIME=${endYm}`
    + `&KEY=${encodeURIComponent(key)}&Type=json`;

  const res = await fetch(url);
  const text = await res.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error('R-ONE 응답을 해석할 수 없습니다 (JSON 파싱 실패)');
  }

  if (json.RESULT) {
    throw new Error(json.RESULT.MESSAGE || `오류: ${json.RESULT.CODE}`);
  }

  const blocks = json.SttsApiTblData || [];
  const headBlock = blocks.find((b) => b.head);
  const rowBlock = blocks.find((b) => b.row);
  const resultInfo = headBlock?.head?.find((h) => h.RESULT)?.RESULT;
  if (resultInfo && resultInfo.CODE && resultInfo.CODE !== 'INFO-000') {
    throw new Error(resultInfo.MESSAGE || resultInfo.CODE);
  }

  const rows = rowBlock?.row || [];
  return rows.map((r) => ({
    ym: r.WRTTIME_IDTFR_ID,
    ymDesc: r.WRTTIME_DESC,
    // 한국부동산원 R-ONE 응답은 보통 "천원" 단위로 내려오는데, 사이트 전체가 "만원" 단위로
    // 통일돼 있으므로 여기서 한 번에 변환해서 이후 화면(KPI/차트/랭킹)이 전부 맞게 만든다.
    value: r.UI_NM === '천원' ? Number(r.DTA_VAL) / 10 : Number(r.DTA_VAL),
    unit: r.UI_NM === '천원' ? '만원' : r.UI_NM,
    regionName: r.CLS_FULLNM || r.CLS_NM,
  }));
}

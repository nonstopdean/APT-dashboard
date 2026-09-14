const RONE_BASE = 'https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do';

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
    value: Number(r.DTA_VAL),
    unit: r.UI_NM,
    regionName: r.CLS_FULLNM || r.CLS_NM,
  }));
}

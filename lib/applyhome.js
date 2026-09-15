// 한국부동산원 청약홈_APT 분양정보 상세조회. odcloud 게이트웨이, JSON 응답.
export async function fetchAptSubscriptions(serviceKey, sidoName, fromDate) {
  const params = new URLSearchParams();
  params.set('page', '1');
  params.set('perPage', '50');
  params.set('returnType', 'JSON');
  if (sidoName) params.set('cond[SUBSCRPT_AREA_CODE_NM::EQ]', sidoName);
  if (fromDate) params.set('cond[RCRIT_PBLANC_DE::GTE]', fromDate);
  params.set('serviceKey', serviceKey);

  const url = `https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  const rows = Array.isArray(json?.data) ? json.data : [];
  return rows
    .map((r) => ({
      houseName: r.HOUSE_NM,
      area: r.SUBSCRPT_AREA_CODE_NM,
      address: r.HSSPLY_ADRES,
      totalUnits: r.TOT_SUPLY_HSHLDCO,
      announceDate: r.RCRIT_PBLANC_DE,
      receiptStart: r.RCEPT_BGNDE,
      receiptEnd: r.RCEPT_ENDDE,
      winnerDate: r.PRZWNER_PRESNATN_DE,
      moveInMonth: r.MVN_PREARNGE_YM,
      builder: r.CNSTRCT_ENTRPS_NM,
      isSpeculationOverheated: r.SPECLT_RDN_EARTH_AT === 'Y',
      isAdjustmentTarget: r.MDAT_TRGET_AREA_SECD === 'Y',
      url: r.PBLANC_URL,
    }))
    .sort((a, b) => (b.announceDate || '').localeCompare(a.announceDate || ''));
}

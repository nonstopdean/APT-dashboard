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
  return mapRows(rows);
}

// v231: 입주 물량용 — fromDate 이후 공고를 전부 받는다(한 쪽 500건, 최대 maxPages쪽). 공고는 자주 안 바뀌어서 6시간 저장해 쓴다.
export async function fetchAptSubscriptionsAll(serviceKey, sidoName, fromDate, maxPages = 8) {
  const PER = 500;
  const urlOf = (page) => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('perPage', String(PER));
    params.set('returnType', 'JSON');
    if (sidoName) params.set('cond[SUBSCRPT_AREA_CODE_NM::EQ]', sidoName);
    if (fromDate) params.set('cond[RCRIT_PBLANC_DE::GTE]', fromDate);
    params.set('serviceKey', serviceKey);
    return `https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail?${params.toString()}`;
  };
  const getPage = async (page) => {
    const res = await fetch(urlOf(page), { next: { revalidate: 21600 } });
    if (!res.ok) throw new Error(`청약홈 응답 오류(${res.status})`);
    return res.json();
  };
  const first = await getPage(1);
  const rows = Array.isArray(first?.data) ? [...first.data] : [];
  // odcloud: totalCount는 조건과 상관없는 전체 건수, matchCount가 조건에 맞는 건수다(v231 첫 판은 totalCount로 빈 쪽을 더 받았다).
  const total = Number(first?.matchCount ?? first?.totalCount) || rows.length;
  const pages = Math.min(maxPages, Math.ceil(total / PER));
  if (pages > 1) {
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => getPage(i + 2)));
    rest.forEach((j) => { if (Array.isArray(j?.data)) rows.push(...j.data); });
  }
  return { rows: mapRows(rows), total, truncated: total > pages * PER };
}

function mapRows(rows) {
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

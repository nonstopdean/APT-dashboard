// 브이월드(VWorld) API — 주소를 PNU(19자리 고유번호)로 변환한 뒤, 그 번호로 공동주택 공시가격을 조회한다.

export async function searchPnu(vworldKey, addressQuery) {
  const url = `https://api.vworld.kr/req/search`
    + `?service=search&request=search&version=2.0&crs=EPSG:900913`
    + `&size=5&page=1&query=${encodeURIComponent(addressQuery)}`
    + `&type=address&category=parcel&format=json&errorformat=json&key=${encodeURIComponent(vworldKey)}`;
  const res = await fetch(url);
  const json = await res.json();
  const items = json?.response?.result?.items || json?.result?.items;
  const pnu = items?.[0]?.id;
  return pnu || null;
}

export async function fetchApartHousingPrice(vworldKey, pnu, dongNm, hoNm) {
  const params = new URLSearchParams({
    key: vworldKey,
    domain: 'vworld',
    pnu,
    format: 'json',
    numOfRows: '20',
    pageNo: '1',
  });
  if (dongNm) params.set('dongNm', dongNm);
  if (hoNm) params.set('hoNm', hoNm);

  const url = `https://api.vworld.kr/ned/data/getApartHousingPriceAttr?${params.toString()}`;
  const res = await fetch(url);
  const json = await res.json();
  const fields = json?.aptHousingPriceAttr?.field || json?.field;
  if (!Array.isArray(fields)) return [];
  return fields.map((f) => ({
    complexName: f.aphusNm,
    dong: f.dongNm,
    ho: f.hoNm,
    area: parseFloat(f.prvuseAr),
    price: parseInt(f.pblntfPc, 10), // 원 단위
    year: f.stdrYear,
  }));
}

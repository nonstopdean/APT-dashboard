// 브이월드(VWorld) API — 주소를 PNU(19자리 고유번호)로 변환한 뒤, 그 번호로 공동주택 공시가격을 조회한다.

// v221: 예전엔 res.json()이 실패하면(브이월드가 JSON이 아닌 오류 페이지를 줄 때) 원인 없이 500 "불러오지 못했습니다"만 남았다.
// 응답 상태와 브이월드 오류 코드만(키·주소는 빼고) 한국어 문장으로 올려서 화면·로그에서 원인을 알 수 있게 한다.
async function readJson(res, label) {
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = null; }
  if (!json || typeof json !== 'object') {
    const kind = /<html|<!doctype/i.test(text) ? '웹페이지' : /^\s*</.test(text) ? 'XML' : '알 수 없는 형식';
    throw new Error(`브이월드 ${label} 응답을 읽지 못했어요 (HTTP ${res.status}, ${kind})`);
  }
  return json;
}

// 브이월드 오류 응답에서 대문자 오류 코드만 꺼낸다(설명 문장에는 요청 값이 섞일 수 있어 쓰지 않는다).
function vworldErrorCode(json) {
  const err = json?.response?.error || json?.error || json?.response?.result?.error;
  const code = err && (err.code || err.errorCode);
  if (typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code)) return code;
  if (json?.response?.status === 'ERROR') return 'ERROR';
  return null;
}

export async function searchPnu(vworldKey, addressQuery) {
  const url = `https://api.vworld.kr/req/search`
    + `?service=search&request=search&version=2.0&crs=EPSG:900913`
    + `&size=5&page=1&query=${encodeURIComponent(addressQuery)}`
    + `&type=address&category=parcel&format=json&errorformat=json&key=${encodeURIComponent(vworldKey)}`;
  const res = await fetch(url);
  const json = await readJson(res, '주소 검색');
  const code = vworldErrorCode(json);
  if (code) throw new Error(`브이월드 주소 검색 오류 (${code})`);
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
  const json = await readJson(res, '공시가격');
  const code = vworldErrorCode(json);
  if (code) throw new Error(`브이월드 공시가격 오류 (${code})`);
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

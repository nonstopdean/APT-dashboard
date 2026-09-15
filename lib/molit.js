import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ parseTagValue: false });

function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function normalizeItem(raw) {
  const amount = parseInt(String(raw.dealAmount ?? '').replace(/,/g, ''), 10);
  const area = parseFloat(raw.excluUseAr);
  const pyeong = area ? area / 3.3058 : null;
  return {
    apt: String(raw.aptNm ?? raw.offiNm ?? raw.mhouseNm ?? '').trim(),
    dong: String(raw.umdNm ?? '').trim(),
    aptDong: String(raw.aptDong ?? '').trim(),
    amount,
    area,
    pyeong,
    pricePerPyeong: pyeong && Number.isFinite(amount) ? amount / pyeong : null,
    floor: raw.floor,
    year: raw.dealYear,
    month: raw.dealMonth,
    day: raw.dealDay,
    buildYear: raw.buildYear,
  };
}

export function parseTradeXml(text) {
  let obj;
  try {
    obj = parser.parse(text);
  } catch (e) {
    throw new Error('응답을 해석할 수 없습니다 (XML 파싱 실패)');
  }

  const resp = obj.response;
  if (resp) {
    const resultCode = String(resp.header?.resultCode ?? '');
    if (resultCode !== '000') {
      throw new Error(resp.header?.resultMsg || `오류 코드 ${resultCode}`);
    }
    const totalCount = Number(resp.body?.totalCount || 0);
    const items = toArray(resp.body?.items?.item)
      .map(normalizeItem)
      .filter((t) => Number.isFinite(t.amount) && t.amount > 0);
    return { items, totalCount };
  }

  const errResp = obj.OpenAPI_ServiceResponse;
  if (errResp) {
    const msg = errResp.cmmMsgHeader?.returnAuthMsg || errResp.cmmMsgHeader?.errMsg || '인증 오류';
    throw new Error(msg);
  }

  throw new Error('알 수 없는 응답 형식입니다.');
}

export async function fetchRegionMonth(serviceKey, code, ym) {
  const collected = [];
  let page = 1;
  const maxPages = 4;
  while (page <= maxPages) {
    const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade`
      + `?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=${code}&DEAL_YMD=${ym}`
      + `&numOfRows=1000&pageNo=${page}`;
    const res = await fetch(url);
    const text = await res.text();
    const { items, totalCount } = parseTradeXml(text);
    collected.push(...items);
    if (collected.length >= totalCount || items.length === 0) break;
    page += 1;
  }
  return collected;
}

export async function fetchOffiTradeMonth(serviceKey, code, ym) {
  const collected = [];
  let page = 1;
  const maxPages = 4;
  while (page <= maxPages) {
    const url = `https://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade`
      + `?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=${code}&DEAL_YMD=${ym}`
      + `&numOfRows=1000&pageNo=${page}`;
    const res = await fetch(url);
    const text = await res.text();
    const { items, totalCount } = parseTradeXml(text);
    collected.push(...items);
    if (collected.length >= totalCount || items.length === 0) break;
    page += 1;
  }
  return collected;
}

export async function fetchSilvTradeMonth(serviceKey, code, ym) {
  const collected = [];
  let page = 1;
  const maxPages = 4;
  while (page <= maxPages) {
    const url = `https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade`
      + `?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=${code}&DEAL_YMD=${ym}`
      + `&numOfRows=1000&pageNo=${page}`;
    const res = await fetch(url);
    const text = await res.text();
    const { items, totalCount } = parseTradeXml(text);
    collected.push(...items);
    if (collected.length >= totalCount || items.length === 0) break;
    page += 1;
  }
  return collected;
}

export async function fetchOffiRentMonth(serviceKey, code, ym) {
  const collected = [];
  let page = 1;
  const maxPages = 4;
  while (page <= maxPages) {
    const url = `https://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent`
      + `?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=${code}&DEAL_YMD=${ym}`
      + `&numOfRows=1000&pageNo=${page}`;
    const res = await fetch(url);
    const text = await res.text();
    const { items, totalCount } = parseRentXml(text);
    collected.push(...items);
    if (collected.length >= totalCount || items.length === 0) break;
    page += 1;
  }
  return collected;
}

// 국토교통부_공동주택 단지 목록제공 서비스 (시군구 단위). XML이 아니라 JSON으로 응답한다.
export async function fetchAptListBySigungu(serviceKey, sigunguCode) {
  const collected = [];
  let page = 1;
  const maxPages = 10;
  while (page <= maxPages) {
    const url = `https://apis.data.go.kr/1613000/AptListService4/getSigunguAptList4`
      + `?serviceKey=${encodeURIComponent(serviceKey)}&sigunguCode=${sigunguCode}`
      + `&pageNo=${page}&numOfRows=100&_type=json`;
    const res = await fetch(url);
    const json = await res.json();
    const body = json?.response?.body;
    if (!body) break;
    const items = Array.isArray(body.items) ? body.items : (body.items ? [body.items] : []);
    collected.push(...items.map((it) => ({
      kaptCode: it.kaptCode,
      kaptName: it.kaptName,
      bjdCode: it.bjdCode,
      sido: it.as1,
      sigungu: it.as2,
      dong: it.as3,
    })));
    const totalCount = body.totalCount || 0;
    if (collected.length >= totalCount || items.length === 0) break;
    page += 1;
  }
  return collected;
}

// 국토교통부_공동주택 기본 정보제공 서비스 (단지코드 기준). JSON 응답.
export async function fetchAptBasicInfo(serviceKey, kaptCode) {
  const url = `https://apis.data.go.kr/1613000/AptBasisInfoServiceV5/getAphusBassInfoV5`
    + `?serviceKey=${encodeURIComponent(serviceKey)}&kaptCode=${kaptCode}&_type=json`;
  const res = await fetch(url);
  const json = await res.json();
  const item = json?.response?.body?.item;
  if (!item) return null;
  return {
    raw: item,
    kaptName: item.kaptName,
    households: item.kaptdaCnt ?? item.hoCnt ?? null,
    dongCount: item.kaptDongCnt ?? null,
    useDate: item.kaptUsedate ?? item.kaptUseDate ?? item.kaptMarea ?? null,
    builder: item.kaptBcompany ?? null,
    developer: item.kaptAcompany ?? null,
    address: item.bjdCode ?? item.doroJuso ?? item.kaptAddr ?? null,
  };
}

// 한국부동산원_공동주택 단지 식별정보 (odcloud 게이트웨이, 지역 필터 없이 주소로 조건검색 시도).
// 주로 국토부 기본정보에서 매칭이 안 될 때 보조로 쓴다.
export async function fetchAptIdentityByAddress(serviceKey, addressQuery) {
  const url = `https://api.odcloud.kr/api/15106861/v1/uddi:46a20910-19aa-462e-ba09-e897b77d0e76`
    + `?page=1&perPage=20&returnType=JSON`
    + `&cond[주소::LIKE]=${encodeURIComponent(addressQuery)}`
    + `&serviceKey=${encodeURIComponent(serviceKey)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  const rows = Array.isArray(json?.data) ? json.data : [];
  return rows.map((r) => ({
    complexId: r['단지고유번호'],
    address: r['주소'],
    nameKb: r['단지명_공시가격'],
    nameBldg: r['단지명_건축물대장'],
    nameRoad: r['단지명_도로명주소'],
    dongCount: r['동수'],
    households: r['세대수'],
    useDate: r['사용승인일'],
  }));
}

function normalizeRentItem(raw) {
  const deposit = parseInt(String(raw.deposit ?? '').replace(/,/g, ''), 10) || 0;
  const monthlyRent = parseInt(String(raw.monthlyRent ?? '').replace(/,/g, ''), 10) || 0;
  const area = parseFloat(raw.excluUseAr);
  const pyeong = area ? area / 3.3058 : null;
  return {
    apt: String(raw.aptNm ?? raw.offiNm ?? raw.mhouseNm ?? '').trim(),
    dong: String(raw.umdNm ?? '').trim(),
    aptDong: String(raw.aptDong ?? '').trim(),
    deposit,
    monthlyRent,
    isJeonse: monthlyRent === 0,
    area,
    pyeong,
    depositPerPyeong: pyeong ? deposit / pyeong : null,
    floor: raw.floor,
    year: raw.dealYear,
    month: raw.dealMonth,
    day: raw.dealDay,
    contractType: raw.contractType,
  };
}

export function parseRentXml(text) {
  let obj;
  try {
    obj = parser.parse(text);
  } catch (e) {
    throw new Error('응답을 해석할 수 없습니다 (XML 파싱 실패)');
  }

  const resp = obj.response;
  if (resp) {
    const resultCode = String(resp.header?.resultCode ?? '');
    if (resultCode !== '000') {
      throw new Error(resp.header?.resultMsg || `오류 코드 ${resultCode}`);
    }
    const totalCount = Number(resp.body?.totalCount || 0);
    const items = toArray(resp.body?.items?.item)
      .map(normalizeRentItem)
      .filter((t) => Number.isFinite(t.deposit));
    return { items, totalCount };
  }

  const errResp = obj.OpenAPI_ServiceResponse;
  if (errResp) {
    const msg = errResp.cmmMsgHeader?.returnAuthMsg || errResp.cmmMsgHeader?.errMsg || '인증 오류';
    throw new Error(msg);
  }

  throw new Error('알 수 없는 응답 형식입니다.');
}

export async function fetchRegionMonthRent(serviceKey, code, ym) {
  const collected = [];
  let page = 1;
  const maxPages = 4;
  while (page <= maxPages) {
    const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent`
      + `?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=${code}&DEAL_YMD=${ym}`
      + `&numOfRows=1000&pageNo=${page}`;
    const res = await fetch(url);
    const text = await res.text();
    const { items, totalCount } = parseRentXml(text);
    collected.push(...items);
    if (collected.length >= totalCount || items.length === 0) break;
    page += 1;
  }
  return collected;
}

export async function runPool(tasks, concurrency) {
  let idx = 0;
  const results = new Array(tasks.length);
  async function worker() {
    while (idx < tasks.length) {
      const my = idx++;
      try {
        results[my] = await tasks[my]();
      } catch (e) {
        results[my] = { error: e };
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

export function lastNMonths(n) {
  const arr = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i++) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    arr.unshift(`${y}${m}`);
    d.setMonth(d.getMonth() - 1);
  }
  return arr;
}

// "YYYYMM" 형태의 시작월~종료월(포함) 사이 모든 월을 배열로 반환한다.
export function monthsBetween(startYm, endYm) {
  const parse = (ym) => ({ y: parseInt(ym.slice(0, 4), 10), m: parseInt(ym.slice(4, 6), 10) });
  const s = parse(startYm);
  const e = parse(endYm);
  const arr = [];
  const d = new Date(s.y, s.m - 1, 1);
  const end = new Date(e.y, e.m - 1, 1);
  while (d <= end && arr.length < 60) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    arr.push(`${y}${m}`);
    d.setMonth(d.getMonth() + 1);
  }
  return arr;
}

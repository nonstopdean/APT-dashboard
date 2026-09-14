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
    apt: String(raw.aptNm ?? '').trim(),
    dong: String(raw.umdNm ?? '').trim(),
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

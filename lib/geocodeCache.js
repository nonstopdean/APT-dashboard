// 탭을 오가면서 지도 컴포넌트가 다시 마운트되거나, 카카오/네이버 지도 사이를 오가도
// 한 번 찾은 단지 좌표는 다시 검색하지 않도록 모듈 스코프(앱이 켜져있는 동안 유지)에 둔다.
// key -> {lat,lng} | null(검색 실패)
export const geocodeCache = {};

// 서버 저장분 조회 통계(이번 접속 동안 누적): 몇 개를 물어서 몇 개가 이미 저장돼 있었는지.
// 예열·기존 좌표 변환이 잘 됐는지 화면 카드로 확인하는 데 쓴다.
export const serverGeocodeStats = { calls: 0, asked: 0, hit: 0 };
// 이미 물어본 키는 다시 묻지 않는다(지도를 움직일 때마다 같은 키를 반복 조회하면 서버 부담이 커지고 통계도 부풀려진다).
const serverAsked = new Set();

// 서버(Vercel KV)에 이미 저장된 좌표가 있는지 한 번에 묻는다 — 다른 방문자가 이미 찾아둔
// 좌표라면 카카오에 다시 물어보지 않고 즉시 재사용할 수 있다.
export async function fetchServerGeocodeCache(keys) {
  const fresh = (keys || []).filter((k) => k && !serverAsked.has(k));
  if (fresh.length === 0) return {};
  fresh.forEach((k) => serverAsked.add(k));
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: fresh }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const json = await res.json();
    const data = json?.data || {};
    serverGeocodeStats.calls += 1;
    serverGeocodeStats.asked += fresh.length;
    serverGeocodeStats.hit += Object.keys(data).length;
    return data;
  } catch (e) {
    // 서버 캐시 조회가 느리거나 실패해도 지도는 계속 동작해야 하므로 빈 결과로 넘어간다.
    // 실패한 키는 다음에 다시 물어볼 수 있게 되돌려 둔다.
    fresh.forEach((k) => serverAsked.delete(k));
    return {};
  }
}

// 새로 찾은 좌표를 서버에 저장해서, 다음 방문자(또는 나중의 나)는 다시 검색할 필요가 없게 한다.
// 실패해도 조용히 넘어간다 — 저장이 안 되면 다음에 또 검색하면 그만이다.
export function queueServerGeocodeSave(entries) {
  if (!entries || entries.length === 0) return;
  fetch('/api/geocode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  }).catch(() => {});
}

// 여러 개를 동시에 몇 개씩 묶어서 처리하는 간단한 동시성 풀. 하나씩 순서대로 기다리지 않고
// concurrency 개수만큼 병렬로 처리해서 전체 소요 시간을 줄인다.
export async function runPool(items, worker, concurrency) {
  let i = 0;
  const runners = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i;
      i += 1;
      // eslint-disable-next-line no-await-in-loop
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

// 탭을 오가면서 지도 컴포넌트가 다시 마운트되거나, 카카오/네이버 지도 사이를 오가도
// 한 번 찾은 단지 좌표는 다시 검색하지 않도록 모듈 스코프(앱이 켜져있는 동안 유지)에 둔다.
// key -> {lat,lng} | null(검색 실패)
export const geocodeCache = {};

// 서버(Vercel KV)에 이미 저장된 좌표가 있는지 한 번에 묻는다 — 다른 방문자가 이미 찾아둔
// 좌표라면 카카오에 다시 물어보지 않고 즉시 재사용할 수 있다.
export async function fetchServerGeocodeCache(keys) {
  if (!keys || keys.length === 0) return {};
  try {
    const res = await fetch(`/api/geocode?keys=${keys.map(encodeURIComponent).join(',')}`);
    const json = await res.json();
    return json?.data || {};
  } catch (e) {
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

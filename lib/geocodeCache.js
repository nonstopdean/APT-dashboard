// 탭을 오가면서 지도 컴포넌트가 다시 마운트되거나, 카카오/네이버 지도 사이를 오가도
// 한 번 찾은 단지 좌표는 다시 검색하지 않도록 모듈 스코프(앱이 켜져있는 동안 유지)에 둔다.
// key -> {lat,lng} | null(검색 실패)
export const geocodeCache = {};

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

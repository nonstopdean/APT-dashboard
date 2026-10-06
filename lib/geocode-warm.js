// 예열(지역의 모든 단지 좌표를 미리 찾아 저장)의 핵심 로직. 외부 호출(카카오, 저장소)은 주입받아서
// 시간 제한·이어하기·건너뛰기 같은 동작을 가짜 의존성으로 테스트할 수 있다.
//
// 예전 문제: 지역의 모든 단지를 다 검색한 "뒤에" 한 번에 저장해서, 단지가 많아 60초 제한에 걸리면
// 그때까지 찾은 것을 전부 잃었고, 다시 돌려도 이미 찾은 단지까지 처음부터 다시 검색했다.
//  - 한 묶음(chunkSize개)을 찾을 때마다 바로 저장해서 중간에 끊겨도 잃는 건 한 묶음뿐이다.
//  - 이미 저장된 단지는 건너뛰어서, 여러 번 돌려도 이어서 진행된다(force=true면 전부 다시).
//  - 시간 예산(budgetMs)을 넘기면 멈추고 partial/nextStart를 돌려준다 → 호출하는 쪽이 이어서 부른다.
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

export async function warmRegion({
  regionCode, list, start = 0, force = false,
  geocode, store, budgetMs = 48000, chunkSize = 40, concurrency = 8, now = Date.now,
}) {
  const keyOf = (item) => `${regionCode}|${item.dong}|${item.kaptName}`;
  const t0 = now();
  const begin = Math.max(0, Math.min(start, list.length));
  const slice = list.slice(begin).map((item, i) => ({ item, index: begin + i }));

  let cached = 0;
  let todo = slice;
  if (!force && slice.length) {
    const { data } = await store.read(slice.map((s) => keyOf(s.item)));
    todo = slice.filter((s) => !data[keyOf(s.item)]);
    cached = slice.length - todo.length;
  }

  let newlyFound = 0;
  let tried = 0;
  let nextStart = null;
  for (let i = 0; i < todo.length; i += chunkSize) {
    if (now() - t0 > budgetMs) { nextStart = todo[i].index; break; }
    const part = todo.slice(i, i + chunkSize);
    const entries = [];
    // eslint-disable-next-line no-await-in-loop
    await runPool(part, async ({ item }) => {
      const coord = await geocode(item);
      if (coord) entries.push({ key: keyOf(item), lat: coord.lat, lng: coord.lng });
    }, concurrency);
    tried += part.length;
    // eslint-disable-next-line no-await-in-loop
    if (entries.length) await store.write(entries);
    newlyFound += entries.length;
  }
  return {
    totalComplexes: list.length,
    processedFrom: begin,
    cached, // 이번 구간에서 이미 저장돼 있어 건너뛴 수
    newlyFound,
    notFound: tried - newlyFound, // 검색해봤지만 못 찾은 수
    found: cached + newlyFound,
    partial: nextStart != null,
    nextStart,
  };
}

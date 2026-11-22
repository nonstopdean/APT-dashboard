// v245: 실거래 API(trades·rents·offi·silv)에 ?apt=단지명&dong=법정동 을 붙이면 그 단지 거래만 돌려준다.
// 단지 상세의 실거래가 탭은 단지 하나만 보면 되는데, 예전엔 구 전체 3년치(송파 전월세 14.5MB, 16초)를 받아서 걸렀다.
// 지도·대시보드처럼 apt를 안 붙이는 호출은 그대로다.
export function filterToComplex(data, searchParams) {
  const apt = String(searchParams.get('apt') || '').trim();
  if (!apt) return data;
  const dong = String(searchParams.get('dong') || '').trim();
  const out = {};
  Object.keys(data).forEach((k) => {
    out[k] = (data[k] || []).filter((r) => r && r.apt === apt && (!dong || r.dong === dong));
  });
  return out;
}

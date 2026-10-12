// 공급면적 기준 평형 추정(v193). 국토부 실거래 자료에는 전용면적만 있어서, 흔히 쓰는 환산
// (전용 59㎡→25평, 84㎡→34평, 114㎡→45평)에 맞춘 근사식으로 공급 평형을 추정한다.
// 단지마다 실제 공급면적(전용률)은 달라서 1평 안팎 차이가 날 수 있다.
export function supplyPyeong(area) {
  const a = Number(area);
  if (!Number.isFinite(a) || a <= 0) return null;
  return Math.round(Math.round(a) * 0.36 + 3.8); // 화면에 보이는 ㎡ 정수로 먼저 맞춰, 같은 "110㎡"가 늘 같은 평으로 나오게(v194)
}

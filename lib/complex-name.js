import { normalizeComplexName } from './complex-match';

// 실거래와 K-apt 단지 목록은 같은 단지를 조금씩 다르게 적는다("목동신시가지 1단지" / "목동신시가지1단지").
// 지도에서 같은 단지가 핀 두 개로 보이지 않게, 같은 지역·동에서 이름이 "정규화 후 완전히 같은" 경우만
// 같은 단지로 본다. 정규화 규칙은 lib/complex-match.js 하나만 쓴다(목록만 단지 진단 패널과 같은 기준).
// 글자 겹침으로 "비슷해 보이는" 후보는 그 파일의 주석대로 사람이 눈으로 확인하기 전에는 합치지 않는다.
export function complexIdentity(regionCode, dong, name) {
  // "아파트"만 있는 이름처럼 정규화하면 빈 값이 되는 경우는 원래 글자를 써서 서로 엉키지 않게 한다.
  const norm = normalizeComplexName(name) || String(name || '').toLowerCase().replace(/\s+/g, '');
  return `${regionCode}|${String(dong || '').trim()}|${norm}`;
}

// 실거래 데이터의 단지명과 K-apt 단지 목록의 단지명은 같은 단지라도 표기가 조금씩 다르다
// ("목동신시가지 1단지" / "목동신시가지1단지", "현대아파트" / "현대"). 같은 동 안에서 이름이
// 정규화한 값이 같으면 같은 단지로 보고 목록 쪽 중복을 합치기 위한 정규화 함수.
//
// 일부러 보수적으로 만들었다: 공백·기호·"아파트"만 지우고, 괄호 안 내용은 남긴다.
// ("래미안(1단지)"와 "래미안(2단지)"가 합쳐지면 안 되니까.) 표기가 더 크게 다른 경우
// ("목동 3단지" / "목동신시가지3단지")는 합치지 못하고 그대로 둔다 — 틀리게 합치는 것보다 낫다.
export function normalizeComplexName(name) {
  const raw = String(name || '').toLowerCase();
  const compact = raw.replace(/[\s\-_.,·'"`/\\]/g, '').replace(/[()[\]{}]/g, '');
  const noApt = compact.replace(/아파트/g, '');
  return noApt || compact;
}

// 거래에서 나온 단지 키 집합 → 목록 단지가 그중 하나와 같은 단지인지.
export function complexIdentity(regionCode, dong, name) {
  return `${regionCode}|${String(dong || '').trim()}|${normalizeComplexName(name)}`;
}

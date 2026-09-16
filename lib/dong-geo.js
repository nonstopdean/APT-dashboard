// 시/도별 행정동 경계 GeoJSON을 필요할 때만 받아온다 (전국을 한 번에 받으면 너무 커서).
// 출처: raqoon886/Local_HangJeongDong (17개 광역시/도 행정동 경계, adm_nm 필드 포함)
const cache = {}; // 시도명 -> Promise<features>

const FILE_NAME = {
  서울특별시: '서울특별시', 부산광역시: '부산광역시', 대구광역시: '대구광역시', 인천광역시: '인천광역시',
  광주광역시: '광주광역시', 대전광역시: '대전광역시', 울산광역시: '울산광역시', 세종특별자치시: '세종특별자치시',
  경기도: '경기도', 강원특별자치도: '강원도', 충청북도: '충청북도', 충청남도: '충청남도',
  전북특별자치도: '전라북도', 전라남도: '전라남도', 경상북도: '경상북도', 경상남도: '경상남도',
  제주특별자치도: '제주특별자치도',
};

export function fetchDongGeoForSido(sidoName) {
  const fileSido = FILE_NAME[sidoName] || sidoName;
  if (!cache[fileSido]) {
    const url = `https://cdn.jsdelivr.net/gh/raqoon886/Local_HangJeongDong@master/hangjeongdong_${encodeURIComponent(fileSido)}.geojson`;
    cache[fileSido] = fetch(url)
      .then((r) => r.json())
      .then((geojson) => geojson.features || [])
      .catch(() => []);
  }
  return cache[fileSido];
}

// "역삼1동" -> "역삼동" 처럼, 행정동의 숫자 서브구역 표기를 떼어 법정동 이름과 맞춰본다.
// (완전히 다른 이름으로 병합된 행정동까지 다 맞진 않지만, 가장 흔한 경우는 커버한다.)
export function normalizeDongName(name) {
  return (name || '').replace(/(\d+)동$/, '동').replace(/제(\d+)동$/, '동');
}

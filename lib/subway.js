import stations from './subway-stations.json';

// 하버사인 공식으로 두 좌표 사이 거리(m)를 계산한다.
function distMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 주어진 좌표에서 가장 가까운 지하철역과 도보 거리(분, 성인 평균 도보 속도 80m/분 기준)를 반환한다.
export function nearestStation(lat, lng) {
  if (lat == null || lng == null) return null;
  let best = null;
  let bestDist = Infinity;
  stations.forEach((s) => {
    const d = distMeters(lat, lng, s.lat, s.lng);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  });
  if (!best) return null;
  return {
    name: best.n,
    line: best.l,
    distanceM: Math.round(bestDist),
    walkMin: Math.max(1, Math.round(bestDist / 80)),
  };
}

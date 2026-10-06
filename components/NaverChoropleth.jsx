'use client';

import { useEffect, useRef, useState } from 'react';
import { geocodeCache, runPool, fetchServerGeocodeCache, queueServerGeocodeSave, serverGeocodeStats } from '../lib/geocodeCache';
import { placeContextOf, pickPlace, resolveMarkerCoord, summarizeCoordSources } from '../lib/geocode-pick';

// features: [{ feature, name, code }] - 안정적으로 유지되는 배열. values: features와 같은 순서의
// [number|null] 배열로 색상만 자주 바뀔 수 있다. 클릭할 때마다 도형을 다시 그리지 않기 위해 나눴다.
const EMPTY_KEY_SET = new Set();

// 마커 모양. 비교함에 담은 단지(pinned)는 ★ + 강조 테두리로 구분한다.
function markerHtmlOf(titleText, priceText, pinned) {
  const border = pinned ? '2px solid #b23a2e' : '1px solid rgba(40,35,30,0.18)';
  const bg = pinned ? '#fff4ef' : 'rgba(255,255,255,0.96)';
  const star = pinned ? '<span style="margin-right:3px;color:#b23a2e;">★</span>' : '';
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:auto;cursor:pointer;transform:translateY(-2px);">` +
    `<div style="padding:4px 7px;border-radius:8px;background:${bg};border:${border};box-shadow:0 2px 8px rgba(0,0,0,0.16);font-size:10px;line-height:1.1;white-space:nowrap;color:#2b2722;font-weight:700;">${star}${titleText}${priceText ? `<span style="margin-left:5px;color:#b23a2e;">${priceText}</span>` : ''}</div>` +
    `<div style="width:7px;height:7px;border-radius:50%;background:#b23a2e;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.22);"></div></div>`;
}

export default function NaverChoropleth({
  features, values, colorFor, borderColor, onSelect, height, focusLatLng, complexes, onComplexSelect,
  dongFeatures, dongValues, onZoomTierChange, onViewportChange, onVisibleMarkerCount, onGeocodeStats, onClusterOpen, pinnedKeys, valueFormat, valueNotes, dongValueNotes, stations, schools,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const polygonsRef = useRef([]); // [{ polygon, featureIndex }] - 구 단위
  const dongPolygonsRef = useRef([]); // [{ polygon, featureIndex }] - 동 단위
  const markersRef = useRef([]); // [{ marker, key }]
  const stationMarkersRef = useRef([]);
  const schoolMarkersRef = useRef([]);
  const clustererRef = useRef([]); // [{ overlay }]
  const clusterSignatureRef = useRef('');
  const refineRunningRef = useRef(false); // 동 중심점 마커의 위치 다듬기가 진행 중인지
  const refineAttemptsRef = useRef(0); // 이번 접속에서 다듬기를 시도한 단지 수(과도한 호출 방지)
  // 위치 다듬기 진단 카운터: 화면 카드에 보여서 "어디서 막혔는지"를 바로 알 수 있게 한다.
  //   kakao: 카카오 검색 호출 결과 종류별 횟수 / refine: 단지 단위 결과
  const diagRef = useRef({
    kakao: { calls: 0, picked: 0, zero: 0, rejected: 0, error: 0, lastError: '' },
    refine: { attempted: 0, moved: 0, far: 0, sdkFail: 0 },
  });
  const onClusterOpenRef = useRef(onClusterOpen);
  const pinnedKeysRef = useRef(pinnedKeys || EMPTY_KEY_SET); // 비교함에 담은 단지 키 — 지도에서 ★로 강조하고 클러스터에 묻히지 않게 한다
  const refineTriedRef = useRef(new Set()); // 이번 접속에서 이미 다듬기를 시도한 단지 키(못 찾아도 재시도하지 않음)
  const unmountedRef = useRef(false);
  const districtMetaRef = useRef([]);
  const dongMetaRef = useRef([]);
  const polygonSyncTimerRef = useRef(null);
  const kakaoPlacesRef = useRef(null);
  const infoWindowRef = useRef(null);
  const valuesRef = useRef(values);
  const dongValuesRef = useRef(dongValues);
  const colorForRef = useRef(colorFor);
  const valueNotesRef = useRef(valueNotes); // 툴팁에 값과 함께 보여줄 근거(예: 표본 6→6건), 구/동 각각
  const dongValueNotesRef = useRef(dongValueNotes);
  const valueFormatRef = useRef(valueFormat); // 지도 위에 마우스를 올렸을 때 값을 어떻게 적을지(예: +3.2%). 없으면 반올림한 숫자
  const onSelectRef = useRef(onSelect);
  const onComplexSelectRef = useRef(onComplexSelect);
  const complexesRef = useRef(complexes);
  const onZoomTierChangeRef = useRef(onZoomTierChange);
  const onViewportChangeRef = useRef(onViewportChange);
  const onVisibleMarkerCountRef = useRef(onVisibleMarkerCount);
  const onGeocodeStatsRef = useRef(onGeocodeStats);
  const lastGeocodeStatsRef = useRef('');
  const [loadFailed, setLoadFailed] = useState(false);
  const markerSyncTimerRef = useRef(null);
  const markerSyncSeqRef = useRef(0);

  useEffect(() => { valuesRef.current = values; }, [values]);
  useEffect(() => { dongValuesRef.current = dongValues; }, [dongValues]);
  useEffect(() => { colorForRef.current = colorFor; }, [colorFor]);
  useEffect(() => { valueFormatRef.current = valueFormat; }, [valueFormat]);
  useEffect(() => { valueNotesRef.current = valueNotes; }, [valueNotes]);
  useEffect(() => { dongValueNotesRef.current = dongValueNotes; }, [dongValueNotes]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onComplexSelectRef.current = onComplexSelect; }, [onComplexSelect]);
  useEffect(() => { complexesRef.current = complexes; }, [complexes]);
  useEffect(() => {
    if (zoomTierRef.current !== 'far') applyAllStyles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!complexes?.length]);
  useEffect(() => { onZoomTierChangeRef.current = onZoomTierChange; }, [onZoomTierChange]);
  useEffect(() => { onViewportChangeRef.current = onViewportChange; }, [onViewportChange]);
  useEffect(() => { onVisibleMarkerCountRef.current = onVisibleMarkerCount; }, [onVisibleMarkerCount]);
  useEffect(() => { onGeocodeStatsRef.current = onGeocodeStats; }, [onGeocodeStats]);
  useEffect(() => { onClusterOpenRef.current = onClusterOpen; }, [onClusterOpen]);
  // 비교함이 바뀌면 이미 만들어진 마커의 모양을 바꾸고(★), 클러스터를 다시 만든다.
  useEffect(() => {
    pinnedKeysRef.current = pinnedKeys || EMPTY_KEY_SET;
    if (!mapRef.current || !window.naver?.maps) return;
    markersRef.current.forEach((m) => {
      const isPinned = pinnedKeysRef.current.has(m.key);
      if (m.pinned === isPinned) return;
      m.pinned = isPinned;
      if (typeof m.marker.setIcon === 'function') {
        m.marker.setIcon({ content: markerHtmlOf(m.title, m.priceText, isPinned), anchor: new window.naver.maps.Point(0, 24) });
      }
      if (typeof m.marker.setZIndex === 'function') m.marker.setZIndex(isPinned ? 40 : 20);
    });
    clusterSignatureRef.current = '';
    syncNaverClusterer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedKeys]);
  useEffect(() => { unmountedRef.current = false; return () => { unmountedRef.current = true; }; }, []);

  // 현재 화면 범위를 부모(page.jsx)에 알려준다 — "단지 탐색" 목록을 화면에 보이는 단지로만
  // 좁혀서 보여줄 수 있게 한다 (호갱노노처럼 지도 이동 → 목록 자동 갱신).
  const reportViewport = () => {
    const map = mapRef.current;
    if (!map || !onViewportChangeRef.current) return;
    const b = map.getBounds();
    if (!b) return;
    const sw = b.getSW(); const ne = b.getNE();
    onViewportChangeRef.current({ swLat: sw.lat(), swLng: sw.lng(), neLat: ne.lat(), neLng: ne.lng() });
  };

  // 네이버 zoom: 숫자가 클수록 확대된 상태. far는 12 이하(3km+), mid는 13~15(1km 안팎),
  // near는 16 이상(약 300m 이내)에 대응하도록 잡았다.
  const FAR_ZOOM_LEVEL = 12;
  const NEAR_ZOOM_LEVEL = 16;
  const zoomTierRef = useRef('far'); // 'far' | 'mid' | 'near'

  // 현재 화면(+여유 25%) 범위를 구한다 — 이 범위 안의 단지만 좌표를 찾고 마커를 만들면,
  // 큰 지역을 선택해도 실제 보이는 만큼만 일하므로 훨씬 가볍다.
  const getExpandedBounds = () => {
    const map = mapRef.current;
    if (!map || !window.naver?.maps) return null;
    const b = map.getBounds();
    if (!b) return null;
    const sw = b.getSW();
    const ne = b.getNE();
    const latPad = Math.max((ne.lat() - sw.lat()) * 0.25, 0.002);
    const lngPad = Math.max((ne.lng() - sw.lng()) * 0.25, 0.002);
    return new window.naver.maps.LatLngBounds(
      new window.naver.maps.LatLng(sw.lat() - latPad, sw.lng() - lngPad),
      new window.naver.maps.LatLng(ne.lat() + latPad, ne.lng() + lngPad),
    );
  };

  const isInBounds = (coord, bounds) => {
    if (!coord || !bounds) return false;
    return bounds.hasLatLng(new window.naver.maps.LatLng(coord.lat, coord.lng));
  };

  // 네이버 지도 표시용으로는 좌표 검색(Geocoding) API에 별도 서버 키가 필요해서,
  // 이미 설정된 카카오 JavaScript 키로 좌표만 조회하는 방식을 재사용한다 (지도 자체는 그대로 네이버).
  const ensureKakaoGeocoder = () => new Promise((resolve) => {
    const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
    if (!kakaoKey) return resolve(false);
    if (window.kakao?.maps?.services) return resolve(true);
    let script = document.getElementById('kakao-geocode-sdk');
    if (!script) {
      script = document.createElement('script');
      script.id = 'kakao-geocode-sdk';
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${kakaoKey}&autoload=false&libraries=services`;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', () => {
      window.kakao.maps.load(() => resolve(true));
    });
    script.addEventListener('error', () => resolve(false));
  });

  // ctx({ place, dong, aptName })로 시·도/시군구가 맞는 결과만 채택한다 (첫 번째 결과를 그대로 쓰면
  // 흔한 단지명이 다른 도시로 찍히고, 그 좌표가 공유 캐시에 저장될 수 있었다).
  const geocodeComplex = (query, ctx) => new Promise((resolve) => {
    if (!kakaoPlacesRef.current) return resolve(null);
    const kd = diagRef.current.kakao;
    kd.calls += 1;
    kakaoPlacesRef.current.keywordSearch(query, (result, status) => {
      if (status === window.kakao.maps.services.Status.OK && result?.length) {
        const picked = pickPlace(result, ctx);
        if (picked) kd.picked += 1; else kd.rejected += 1; // 결과는 있었지만 시·도/시군구가 맞는 게 없음
        resolve(picked);
      } else if (status === 'ZERO_RESULT' || (status === window.kakao.maps.services.Status.OK)) {
        kd.zero += 1;
        resolve(null);
      } else {
        kd.error += 1; kd.lastError = String(status);
        resolve(null);
      }
    });
  });

  // 지금 단지들의 좌표가 어디서 왔는지(정확/동 중심/못 찾음/대기)를 세서 화면 카드로 알려준다.
  // 값이 바뀔 때만 부모에 알린다.
  const reportGeocodeStats = () => {
    const cb = onGeocodeStatsRef.current;
    if (!cb || !complexesRef.current?.length) return;
    const stats = summarizeCoordSources(complexesRef.current, geocodeCache);
    const d = diagRef.current;
    const sig = `${stats.total}|${stats.exact}|${stats.approx}|${stats.failed}|${stats.pending}|${d.kakao.calls}|${d.kakao.picked}|${d.kakao.zero}|${d.kakao.rejected}|${d.kakao.error}|${d.refine.attempted}|${d.refine.moved}|${d.refine.far}|${d.refine.sdkFail}|${serverGeocodeStats.calls}|${serverGeocodeStats.asked}|${serverGeocodeStats.hit}`;
    if (sig === lastGeocodeStatsRef.current) return;
    lastGeocodeStatsRef.current = sig;
    cb({ ...stats, kakao: { ...d.kakao }, refine: { ...d.refine }, server: { ...serverGeocodeStats } });
  };

  // 마커는 일단 동 중심점에 띄워 화면을 빨리 보여주고, 정확한 위치를 찾는 대로 옮긴다.
  // 같은 동 단지가 전부 한 점에 겹치면 클러스터러가 어떤 줌에서도 숫자 원 하나로만 묶어서, 확대해도 안 풀렸다.
  //  - 한 번에 REFINE_BATCH개, 동시에 3개씩, 화면 중심에서 가까운 순서로 처리한다.
  //  - 지도를 움직여도 중단하지 않고, 남은 단지는 이어서 처리한다(이전 단계의 seq 중단과 별개).
  //  - 옮긴 뒤에는 클러스터러 서명을 지워 다시 그리게 한다(위치만 바뀌면 서명이 같아 화면이 안 바뀐다).
  //  - 못 찾으면 geocodeCache에 null을 남겨 이번 접속에서는 다시 시도하지 않는다(동 중심점에 그대로 둔다).
  const REFINE_BATCH = 40;
  const REFINE_SESSION_CAP = 800;
  const refineApproxMarkers = async () => {
    if (refineRunningRef.current || unmountedRef.current) return;
    refineRunningRef.current = true;
    try {
      const ready = await ensureKakaoGeocoder();
      if (!ready) { diagRef.current.refine.sdkFail += 1; reportGeocodeStats(); return; }
      if (!kakaoPlacesRef.current) kakaoPlacesRef.current = new window.kakao.maps.services.Places();
      const complexByKey = new Map((complexesRef.current || []).map((c) => [c.key, c]));
      while (!unmountedRef.current && refineAttemptsRef.current < REFINE_SESSION_CAP) {
        if (zoomTierRef.current !== 'near') return;
        const center = mapRef.current?.getCenter?.();
        const clat = center?.lat?.() ?? 0;
        const clng = center?.lng?.() ?? 0;
        // 아직 동 중심점(근사)에 있고 이번 접속에서 시도하지 않은 단지. 서버 캐시에 오염된 값(동에서 너무 멀리
        // 떨어진 좌표)이 있어도 resolveMarkerCoord가 근사로 판정하므로 여기에 포함되어 다시 찾고 덮어쓴다.
        let batch = markersRef.current
          .map((m) => complexByKey.get(m.key))
          .filter((c) => c && c.lat != null && c.lng != null && !refineTriedRef.current.has(c.key)
            && resolveMarkerCoord({ lat: c.lat, lng: c.lng }, geocodeCache[c.key]).source === 'approx')
          .sort((a, b) => ((a.lat - clat) ** 2 + (a.lng - clng) ** 2) - ((b.lat - clat) ** 2 + (b.lng - clng) ** 2))
          .slice(0, REFINE_BATCH);
        if (batch.length === 0) return;

        // 카카오를 부르기 전에 서버 저장분부터 확인한다. 마커를 만들 때 서버 조회가 실패했거나 아직 못 한 단지도
        // 여기서 물어본다(이미 물어본 키는 fetchServerGeocodeCache가 건너뛴다). 예열해 둔 좌표가 있으면
        // 카카오 호출 없이 바로 정확한 위치로 옮긴다.
        // eslint-disable-next-line no-await-in-loop
        const serverHits = await fetchServerGeocodeCache(batch.map((c) => c.key));
        let movedByServer = 0;
        Object.entries(serverHits).forEach(([key, coord]) => {
          geocodeCache[key] = coord;
          const c = complexByKey.get(key);
          const entry = markersRef.current.find((m) => m.key === key);
          if (!c || !entry || typeof entry.marker.setPosition !== 'function') return;
          const { coord: picked, source } = resolveMarkerCoord({ lat: c.lat, lng: c.lng }, coord);
          if (source !== 'exact') return; // 동에서 너무 먼 값(잘못 저장된 좌표)은 쓰지 않는다
          entry.marker.setPosition(new window.naver.maps.LatLng(picked.lat, picked.lng));
          movedByServer += 1;
        });
        if (movedByServer > 0) {
          clusterSignatureRef.current = '';
          syncNaverClusterer();
          reportGeocodeStats();
          batch = batch.filter((c) => resolveMarkerCoord({ lat: c.lat, lng: c.lng }, geocodeCache[c.key]).source === 'approx');
          if (batch.length === 0) continue; // 이번 묶음은 전부 서버 저장분으로 해결됨 — 다음 후보로
        }
        refineAttemptsRef.current += batch.length;
        batch.forEach((c) => refineTriedRef.current.add(c.key));
        diagRef.current.refine.attempted += batch.length;
        const found = [];
        // eslint-disable-next-line no-await-in-loop
        await runPool(batch, async (c) => {
          const ctx = { place: placeContextOf(c.regionCode), dong: c.dong, aptName: c.apt };
          const coord = await geocodeComplex(`${c.regionName} ${c.dong} ${c.apt}`, ctx)
            || await geocodeComplex(`${c.dong} ${c.apt}`, ctx)
            || await geocodeComplex(c.apt, ctx);
          geocodeCache[c.key] = coord; // null이면 못 찾음 — 이번 접속에서는 재시도하지 않는다
          if (!coord) return;
          const { coord: picked, source } = resolveMarkerCoord({ lat: c.lat, lng: c.lng }, coord);
          if (source !== 'exact') { diagRef.current.refine.far += 1; return; } // 동 중심에서 너무 먼 값은 버린다
          const entry = markersRef.current.find((m) => m.key === c.key);
          if (!entry || typeof entry.marker.setPosition !== 'function') return;
          entry.marker.setPosition(new window.naver.maps.LatLng(picked.lat, picked.lng));
          found.push({ key: c.key, lat: picked.lat, lng: picked.lng });
          diagRef.current.refine.moved += 1;
        }, 3);
        if (found.length) {
          queueServerGeocodeSave(found);
          clusterSignatureRef.current = ''; // 위치가 바뀌었으니 클러스터를 다시 만든다
          syncNaverClusterer();
        }
        reportGeocodeStats();
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 250)); // 호출이 몰리지 않게 잠깐 쉰다
      }
    } catch (e) {
      // 위치 다듬기는 부가 기능이라, 실패해도 동 중심점 마커로 계속 동작해야 한다.
    } finally {
      refineRunningRef.current = false;
    }
  };

  const getFeatureBbox = (feature) => {
    const coords = feature?.geometry?.coordinates;
    if (!coords) return null;
    const points = [];
    const walk = (v) => {
      if (!Array.isArray(v)) return;
      if (v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number') { points.push(v); return; }
      v.forEach(walk);
    };
    walk(coords);
    if (!points.length) return null;
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    points.forEach(([lng, lat]) => { minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); });
    return { minLng, maxLng, minLat, maxLat };
  };

  const styleFor = (idx) => {
    const value = valuesRef.current?.[idx];
    const hasValue = value != null;
    const tier = zoomTierRef.current;
    if (tier !== 'far') {
      // 확대된 상태에서는 완전히 투명해진다. "동" 데이터가 비어있는 구간(예: 아파트가 적은
      // 원도심)에서는 동을 눌러도 반응이 없을 수 있으므로, near(마커 활성) 단계가 아닐 때는
      // 이 투명한 구 도형을 계속 클릭 가능하게 남겨서 "구를 고르는" 동작이 항상 되게 한다.
      // near 단계에서는 단지 마커 클릭을 가로채지 않도록 꺼두는 게 원칙이지만, 애초에 마커가
      // 하나도 없으면(아직 아무 지역도 선택 안 함) 가로챌 게 없으므로 그때는 계속 클릭 가능하게 둔다.
      const noMarkersYet = !complexesRef.current?.length;
      return {
        strokeWeight: 0, strokeOpacity: 0, fillColor: colorForRef.current(value), fillOpacity: 0, clickable: tier === 'mid' || noMarkersYet,
      };
    }
    return {
      strokeWeight: hasValue ? 2 : 0.5,
      strokeColor: borderColor || '#8A8172',
      strokeOpacity: hasValue ? 1 : 0.15,
      fillColor: colorForRef.current(value),
      fillOpacity: hasValue ? 0.32 : 0,
      clickable: true,
    };
  };

  const dongStyleFor = (idx) => {
    const value = dongValuesRef.current?.[idx];
    const hasValue = value != null;
    const near = zoomTierRef.current === 'near';
    return {
      strokeWeight: hasValue ? 1.5 : 0.6,
      strokeColor: borderColor || '#8A8172',
      strokeOpacity: near ? (hasValue ? 0.5 : 0.25) : (hasValue ? 0.9 : 0.12),
      fillColor: colorForRef.current(value),
      fillOpacity: near ? (hasValue ? 0.2 : 0.06) : (hasValue ? 0.35 : 0),
    };
  };

  const applyAllStyles = () => {
    polygonsRef.current.forEach(({ polygon, featureIndex }) => {
      polygon.setOptions(styleFor(featureIndex));
    });
    dongPolygonsRef.current.forEach(({ polygon, featureIndex }) => {
      polygon.setOptions(dongStyleFor(featureIndex));
    });
  };

  const updateLayerVisibility = () => {
    if (!mapRef.current) return;
    const tier = zoomTierRef.current;
    // 구 레이어는 far에서만 실제 렌더링한다. 확대 단계에서는 경계가 불필요하게
    // 위에 남아 GPU/Hit-test 비용을 차지하지 않도록 숨긴다.
    polygonsRef.current.forEach(({ polygon }) => polygon.setMap(tier === 'far' ? mapRef.current : null));
    dongPolygonsRef.current.forEach(({ polygon }) => polygon.setMap(tier !== 'far' ? mapRef.current : null));
    syncPolygonViewport();
  };

  // Polygon 객체를 매번 만들고 버리지 않고, 현재 지도 화면(+30%)에 걸치는 도형만
  // 실제 지도에 붙인다. 도형 객체 자체는 캐시하므로 확대/축소 때 재생성 비용이 없다.
  const syncPolygonViewport = () => {
    const map = mapRef.current;
    if (!map || !window.naver?.maps) return;
    const bounds = getExpandedBounds();
    if (!bounds) return;
    const tier = zoomTierRef.current;
    // styleFor()가 "마커가 아직 하나도 없으면 구를 계속 클릭 가능하게 둔다"고 정해도,
    // 여기서 구 도형 자체를 지도에서 완전히 떼어내 버리면(setMap(null)) 그 클릭 설정이 무의미해진다
    // — 도형이 지도에 없으면 이벤트 자체가 안 걸린다. 그래서 같은 예외를 여기도 적용한다.
    const noMarkersYet = !complexesRef.current?.length;
    const apply = (items, visible) => items.forEach(({ polygon, bbox }) => {
      const shouldShow = visible && bboxIntersects(bounds, bbox);
      polygon.setMap(shouldShow ? map : null);
    });
    apply(districtMetaRef.current, tier === 'far' || noMarkersYet);
    apply(dongMetaRef.current, tier !== 'far');
  };

  const bboxIntersects = (bounds, bbox) => {
    if (!bounds || !bbox) return false;
    const sw = bounds.getSW(); const ne = bounds.getNE();
    return !(bbox.maxLat < sw.lat() || bbox.minLat > ne.lat() || bbox.maxLng < sw.lng() || bbox.minLng > ne.lng());
  };

  const schedulePolygonViewportSync = (delay = 60) => {
    if (polygonSyncTimerRef.current) clearTimeout(polygonSyncTimerRef.current);
    polygonSyncTimerRef.current = setTimeout(() => {
      polygonSyncTimerRef.current = null;
      syncPolygonViewport();
    }, delay);
  };

  // 확대(구/단지 단위)하면 색칠은 옅어지다 빠지고 마커가 나타나고, 축소(전체 구역 단위)하면
  // 반대로 색칠은 진해지고 마커는 숨긴다 — 실제 부동산 사이트들과 같은 방식.
  const zoomDebounceRef = useRef(null);

  // 네이버용 클러스터링 — 공식 클러스터러 라이브러리 없이, 지도를 격자로 나눠 겹치는 단지를
  // 하나의 숫자 배지로 묶어 보여준다 (호갱노노/아실처럼). 확대하면 묶음이 풀리면서 개별 마커가 나타난다.
  // handleZoomChangedImmediate가 이 함수를 호출하므로, 반드시 그보다 먼저 선언해야 한다.
  const syncNaverClusterer = () => {
    const map = mapRef.current;
    if (!map || !window.naver?.maps) return;
    const show = map.getZoom() >= NEAR_ZOOM_LEVEL;
    if (!show) {
      clustererRef.current.forEach(({ overlay }) => overlay.setMap(null));
      clustererRef.current = [];
      clusterSignatureRef.current = '';
      markersRef.current.forEach(({ marker }) => marker.setMap(null));
      onVisibleMarkerCountRef.current?.(0);
      return;
    }
    const zoom = map.getZoom();
    const markerSig = markersRef.current.map(({ key }) => key).sort().join(',');
    const signature = `${zoom}|${markerSig}`;
    // 동일한 marker 집합/줌이면 기존 overlay를 그대로 유지한다.
    if (signature === clusterSignatureRef.current) return;

    clustererRef.current.forEach(({ overlay }) => overlay.setMap(null));
    clustererRef.current = [];
    clusterSignatureRef.current = signature;

    const cellDeg = 0.0008 * Math.pow(2, 20 - zoom);
    const buckets = new Map();
    const pinnedMarkers = [];
    markersRef.current.forEach(({ marker, key }) => {
      // 비교함에 담은 단지는 묶지 않고 항상 낱개로 보여준다(밀집 지역에서도 어디 있는지 바로 보이게).
      if (pinnedKeysRef.current.has(key)) { pinnedMarkers.push(marker); return; }
      const pos = marker.getPosition();
      const lat = pos.lat();
      const lng = pos.lng();
      const cellKey = `${Math.round(lat / cellDeg)}|${Math.round(lng / cellDeg)}`;
      if (!buckets.has(cellKey)) buckets.set(cellKey, []);
      buckets.get(cellKey).push({ marker, key, lat, lng });
    });
    buckets.forEach((group) => {
      if (group.length === 1) {
        group[0].marker.setMap(map);
        return;
      }
      // 묶인 마커는 지도에서 뗀다. 줌 인 상태에서 낱개로 붙어 있던 마커가 줌 아웃으로 묶일 때,
      // 떼지 않으면 숫자 원 아래에 핀이 그대로 남아 겹쳐 보인다. (같은 점의 마커는 한 번도 낱개가
      // 된 적이 없어서 드러나지 않던 문제인데, 위치를 정확히 옮기면서 나타나게 된다.)
      group.forEach((g) => g.marker.setMap(null));
      const lat = group.reduce((sum, g) => sum + g.lat, 0) / group.length;
      const lng = group.reduce((sum, g) => sum + g.lng, 0) / group.length;
      const size = group.length;
      const bg = size < 10 ? 'rgba(178,58,46,0.88)' : size < 50 ? 'rgba(178,58,46,0.92)' : 'rgba(122,34,26,0.94)';
      const wh = size < 10 ? 38 : size < 50 ? 48 : 60;
      const overlay = new window.naver.maps.Marker({
        position: new window.naver.maps.LatLng(lat, lng),
        icon: {
          content: `<div style="width:${wh}px;height:${wh}px;border-radius:${wh / 2}px;background:${bg};color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.25);cursor:pointer;">${size}</div>`,
          size: new window.naver.maps.Size(wh, wh),
          anchor: new window.naver.maps.Point(wh / 2, wh / 2),
        },
      });
      overlay.setMap(map);
      const memberKeys = group.map((g) => g.key);
      const spread = Math.max(
        Math.max(...group.map((g) => g.lat)) - Math.min(...group.map((g) => g.lat)),
        Math.max(...group.map((g) => g.lng)) - Math.min(...group.map((g) => g.lng)),
      );
      window.naver.maps.Event.addListener(overlay, 'click', () => {
        // 확대하면 갈라질 수 있을 때만 확대한다. 이미 최대 줌이거나 마커가 사실상 같은 위치(약 5m 이내)면
        // 확대해도 영원히 안 풀리므로(예전엔 눌러도 아무 반응이 없었다) 그 안의 단지 목록을 열어준다.
        const canSeparate = spread > 0.00005 && map.getZoom() < 19;
        if (canSeparate || !onClusterOpenRef.current) {
          map.morph(new window.naver.maps.LatLng(lat, lng), Math.min(map.getZoom() + 2, 19));
        } else {
          onClusterOpenRef.current(memberKeys);
        }
      });
      clustererRef.current.push({ overlay });
    });
    pinnedMarkers.forEach((m) => m.setMap(map));
    onVisibleMarkerCountRef.current?.(markersRef.current.length);
  };

  // 줌 중에는 클러스터를 매 프레임 다시 만들지 않고, 잠깐 멈춘 뒤 한 번만 반영한다.
  const scheduleMarkerSync = (delay = 80) => {
    if (markerSyncTimerRef.current) clearTimeout(markerSyncTimerRef.current);
    markerSyncTimerRef.current = setTimeout(() => {
      markerSyncTimerRef.current = null;
      if (zoomTierRef.current === 'near') syncVisibleMarkers();
      else syncNaverClusterer();
    }, delay);
  };

  const handleZoomChangedImmediate = () => {
    if (!mapRef.current) return;
    const level = mapRef.current.getZoom();
    const tier = level <= FAR_ZOOM_LEVEL ? 'far' : (level >= NEAR_ZOOM_LEVEL ? 'near' : 'mid');
    if (tier !== zoomTierRef.current) {
      zoomTierRef.current = tier;
      applyAllStyles();
      updateLayerVisibility();
      onZoomTierChangeRef.current?.(tier);
    }
    scheduleMarkerSync(120);
    schedulePolygonViewportSync(80);
  };

  const handleZoomChanged = () => {
    if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
    zoomDebounceRef.current = setTimeout(handleZoomChangedImmediate, 150);
  };

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_NAVER_MAP_KEY_ID;
    if (!key) return undefined;

    let cancelled = false;

    function draw() {
      if (cancelled || !containerRef.current || !window.naver?.maps) return;

      if (!mapRef.current) {
        mapRef.current = new window.naver.maps.Map(containerRef.current, {
          center: new window.naver.maps.LatLng(37.5665, 126.978),
          zoom: 11,
        });
        window.naver.maps.Event.addListener(mapRef.current, 'zoom_changed', handleZoomChanged);
      }
      if (!infoWindowRef.current) {
        infoWindowRef.current = new window.naver.maps.InfoWindow({
          content: '',
          borderWidth: 0,
          backgroundColor: 'rgba(33,31,26,0.92)',
          disableAnchor: true,
          pixelOffset: new window.naver.maps.Point(0, -6),
        });
      }

      polygonsRef.current.forEach(({ polygon }) => polygon.setMap(null));
      polygonsRef.current = [];
      districtMetaRef.current = [];

      features.forEach((f, idx) => {
        if (!f.feature) return;
        const geomType = f.feature.geometry.type;
        const polys = geomType === 'Polygon' ? [f.feature.geometry.coordinates] : f.feature.geometry.coordinates;
        // 섬이 많은 지역(전남/경남/인천 등)은 하나의 시/군/구가 수십~수백 개의 조각(섬)으로
        // 이루어져 있다. 조각마다 별개의 Polygon 객체를 만들면 전국 기준 250개가 아니라
        // 수만 개가 생겨서 줌마다 다시 칠하는 비용이 폭발한다 — 조각들을 한 Polygon의
        // 여러 paths로 합쳐서 "지역당 객체 1개"를 유지한다.
        const allPaths = polys.map((rings) => rings[0].map(([lng, lat]) => new window.naver.maps.LatLng(lat, lng)));
        if (allPaths.length === 0) return;

        const polygon = new window.naver.maps.Polygon({
          map: mapRef.current,
          paths: allPaths,
          clickable: true,
          ...styleFor(idx),
        });
        const labelFor = () => {
          const value = valuesRef.current?.[idx];
          const note = valueNotesRef.current?.[idx];
          return value != null ? `${f.name}: ${valueFormatRef.current ? valueFormatRef.current(value) : Math.round(value).toLocaleString()}${note ? ` (${note})` : ''}` : f.name;
        };
        window.naver.maps.Event.addListener(polygon, 'click', () => {
          if (f.code) onSelectRef.current?.(f.code);
        });
        window.naver.maps.Event.addListener(polygon, 'mouseover', (e) => {
          console.log(`[호버] 구 마우스오버: ${f.name}, 현재 티어=${zoomTierRef.current}, 지도에 붙어있음=${!!polygon.getMap()}`);
          if (zoomTierRef.current !== 'far') return;
          const value = valuesRef.current?.[idx];
          const hasValue = value != null;
          // 호버하면 데이터 유무와 상관없이 항상 파란 채움 + 빨간 테두리로 또렷하게 보여준다.
          polygon.setOptions({
            fillOpacity: 0.35,
            fillColor: '#2F6FE0',
            strokeWeight: 3,
            strokeColor: '#E0362F',
          });
          infoWindowRef.current.setContent(
            `<div style="padding:5px 10px;color:#fff;font-size:12px;white-space:nowrap;">${labelFor()}</div>`,
          );
          infoWindowRef.current.open(mapRef.current, e.coord);
        });
        window.naver.maps.Event.addListener(polygon, 'mouseout', () => {
          polygon.setOptions(styleFor(idx));
          infoWindowRef.current.close();
        });
        const bbox = getFeatureBbox(f.feature);
        polygonsRef.current.push({ polygon, featureIndex: idx });
        districtMetaRef.current.push({ polygon, bbox });
      });

      applyAllStyles();
      updateLayerVisibility();
    }

    if (window.naver && window.naver.maps) {
      draw();
    } else {
      let script = document.getElementById('naver-map-sdk');
      if (!script) {
        script = document.createElement('script');
        script.id = 'naver-map-sdk';
        script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${key}`;
        script.async = true;
        script.onerror = () => { if (!cancelled) setLoadFailed(true); };
        document.head.appendChild(script);
      }
      script.addEventListener('load', () => {
        if (!cancelled && window.naver && window.naver.maps) draw();
      });
      if (window.naver && window.naver.maps) draw();
    }

    return () => {
      cancelled = true;
      polygonsRef.current.forEach(({ polygon }) => polygon.setMap(null));
      dongPolygonsRef.current.forEach(({ polygon }) => polygon.setMap(null));
      clustererRef.current.forEach(({ overlay }) => overlay.setMap(null));
      markersRef.current.forEach(({ marker }) => marker.setMap(null));
      markersRef.current = [];
      clustererRef.current = [];
      clusterSignatureRef.current = '';
      if (markerSyncTimerRef.current) clearTimeout(markerSyncTimerRef.current);
      if (polygonSyncTimerRef.current) clearTimeout(polygonSyncTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, borderColor]);

  // "동" 단위 도형 생성 — dongFeatures는 선택된 지역의 시/도가 바뀔 때만 갱신되므로 별도 effect로 둔다.
  useEffect(() => {
    if (!mapRef.current || !window.naver?.maps) return undefined;
    dongPolygonsRef.current.forEach(({ polygon }) => polygon.setMap(null));
    dongPolygonsRef.current = [];
    dongMetaRef.current = [];
    if (!dongFeatures || dongFeatures.length === 0) return undefined;

    let disposed = false;
    let cursor = 0;
    const batchSize = 40;
    const schedule = (fn) => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(fn, { timeout: 120 });
      } else {
        window.setTimeout(fn, 0);
      }
    };
    const createBatch = () => {
      if (disposed || !mapRef.current || !window.naver?.maps) return;
      const end = Math.min(cursor + batchSize, dongFeatures.length);
      for (; cursor < end; cursor += 1) {
        const f = dongFeatures[cursor];
        const idx = cursor;
        if (!f?.feature) continue;
        const geomType = f.feature.geometry.type;
        const polys = geomType === 'Polygon' ? [f.feature.geometry.coordinates] : f.feature.geometry.coordinates;
        const allPaths = polys.map((rings) => rings[0].map(([lng, lat]) => new window.naver.maps.LatLng(lat, lng)));
        if (allPaths.length === 0) continue;

        const polygon = new window.naver.maps.Polygon({
          map: null,
          paths: allPaths,
          clickable: true,
          ...dongStyleFor(idx),
        });
        const labelFor = () => {
          const value = dongValuesRef.current?.[idx];
          const note = dongValueNotesRef.current?.[idx];
          return value != null ? `${f.name}: ${valueFormatRef.current ? valueFormatRef.current(value) : Math.round(value).toLocaleString()}${note ? ` (${note})` : ''}` : f.name;
        };
        window.naver.maps.Event.addListener(polygon, 'click', () => {
          if (f.code) onSelectRef.current?.(f.code);
        });
        window.naver.maps.Event.addListener(polygon, 'mouseover', (e) => {
          const tier = zoomTierRef.current;
          console.log(`[호버] 동 마우스오버: ${f.name}, 현재 티어=${tier}, 지도에 붙어있음=${!!polygon.getMap()}`);
          if (tier === 'far') return;
          const value = dongValuesRef.current?.[idx];
          // 호버하면 데이터 유무와 상관없이 항상 파란 채움 + 빨간 테두리로 또렷하게 보여준다.
          polygon.setOptions({
            fillOpacity: 0.35,
            fillColor: '#2F6FE0',
            strokeWeight: 3,
            strokeColor: '#E0362F',
          });
          infoWindowRef.current?.setContent(
            `<div style="padding:5px 10px;color:#fff;font-size:12px;white-space:nowrap;">${labelFor()}</div>`,
          );
          infoWindowRef.current?.open(mapRef.current, e.coord);
        });
        window.naver.maps.Event.addListener(polygon, 'mouseout', () => {
          polygon.setOptions(dongStyleFor(idx));
          infoWindowRef.current?.close();
        });
        const bbox = getFeatureBbox(f.feature);
        dongPolygonsRef.current.push({ polygon, featureIndex: idx });
        dongMetaRef.current.push({ polygon, bbox });
      }
      syncPolygonViewport();
      if (cursor < dongFeatures.length && !disposed) schedule(createBatch);
    };
    schedule(createBatch);
    return () => {
      disposed = true;
      dongPolygonsRef.current.forEach(({ polygon }) => polygon.setMap(null));
      dongPolygonsRef.current = [];
      dongMetaRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dongFeatures, borderColor]);

  useEffect(() => {
    applyAllStyles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, colorFor]);

  useEffect(() => {
    if (!focusLatLng || !mapRef.current || !window.naver?.maps) return;
    mapRef.current.morph(new window.naver.maps.LatLng(focusLatLng.lat, focusLatLng.lng), 13);
  }, [focusLatLng]);

  // 현재 화면(+여유 25%) 안에 보이는 단지만 좌표를 찾아 마커로 만든다. 큰 지역을 선택해도
  // 실제 보이는 범위만큼만 일하므로 800개를 한꺼번에 처리할 때보다 훨씬 가볍다.
  const syncVisibleMarkers = async () => {
    if (!mapRef.current || !window.naver?.maps || !complexes?.length || zoomTierRef.current !== 'near') return;
    const seq = ++markerSyncSeqRef.current;
    const bounds = getExpandedBounds();
    const center = mapRef.current.getCenter();
    const centerLat = center?.lat?.() ?? 0;
    const centerLng = center?.lng?.() ?? 0;
    // 좌표가 이미 있는 단지는 즉시 사용하고, 좌표가 없는 단지는 geocode 후보로 남긴다.
    // 이전 버전처럼 좌표 없는 단지를 여기서 제외하면 카카오/서버 geocode fallback이 사실상 작동하지 않는다.
    const visibleComplexes = complexes.filter((c) => {
      if (c.lat == null || c.lng == null) return true;
      return isInBounds({ lat: c.lat, lng: c.lng }, bounds);
    });
    // 확대도가 높을수록 화면에 실제로 보이는 단지를 더 많이 표시한다.
    const zoom = mapRef.current.getZoom();
    const maxMarkers = Math.min(600, Math.max(250, 250 + Math.round((zoom - NEAR_ZOOM_LEVEL) * 40)));
    visibleComplexes.sort((a, b) => {
      const da = a.lat == null || a.lng == null ? Number.POSITIVE_INFINITY : (a.lat - centerLat) ** 2 + (a.lng - centerLng) ** 2;
      const db = b.lat == null || b.lng == null ? Number.POSITIVE_INFINITY : (b.lat - centerLat) ** 2 + (b.lng - centerLng) ** 2;
      return da - db;
    });
    const candidate = visibleComplexes.slice(0, maxMarkers);
    const existingKeys = new Set(markersRef.current.map((m) => m.key));
    const wanted = new Set(candidate.map((c) => c.key));

    markersRef.current = markersRef.current.filter((m) => {
      if (wanted.has(m.key)) return true;
      m.marker.setMap(null);
      return false;
    });
    const todo = candidate.filter((c) => !existingKeys.has(c.key));
    if (todo.length === 0) {
      syncNaverClusterer();
      reportGeocodeStats();
      refineApproxMarkers();
      return;
    }

    const ready = await ensureKakaoGeocoder();
    if (seq !== markerSyncSeqRef.current) return;
    if (ready && !kakaoPlacesRef.current) kakaoPlacesRef.current = new window.kakao.maps.services.Places();

    const needServerLookup = todo.filter((c) => geocodeCache[c.key] === undefined).map((c) => c.key);
    if (needServerLookup.length > 0) {
      const serverHits = await fetchServerGeocodeCache(needServerLookup);
      if (seq !== markerSyncSeqRef.current) return;
      Object.entries(serverHits).forEach(([key, coord]) => { geocodeCache[key] = coord; });
    }

    const newlyFound = [];
    await runPool(todo, async (c) => {
      if (seq !== markerSyncSeqRef.current) return;
      // 정확한 좌표(카카오·서버 캐시) > 동 중심점(근사) 순서. 예전에는 동 중심점이 있으면 정확한 좌표를
      // 아예 쓰지 않아서, 서버에 저장해둔(예열한) 좌표가 버려지고 같은 동 단지가 한 점에 겹쳤다.
      const approx = c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : null;
      let { coord } = resolveMarkerCoord(approx, geocodeCache[c.key]);
      if (coord === undefined) {
        if (!ready) return;
        const ctx = { place: placeContextOf(c.regionCode), dong: c.dong, aptName: c.apt };
        coord = await geocodeComplex(`${c.regionName} ${c.dong} ${c.apt}`, ctx)
          || await geocodeComplex(`${c.dong} ${c.apt}`, ctx)
          || await geocodeComplex(c.apt, ctx);
        geocodeCache[c.key] = coord;
        if (coord) newlyFound.push({ key: c.key, lat: coord.lat, lng: coord.lng });
      }
      if (seq !== markerSyncSeqRef.current || !coord) return;
      const priceText = Number.isFinite(c.latestPrice)
        ? (c.latestPrice >= 10000 ? `${(c.latestPrice / 10000).toFixed(c.latestPrice >= 100000 ? 0 : 1)}억` : `${Math.round(c.latestPrice).toLocaleString()}만`)
        : '';
      const titleText = String(c.apt || '').replace(/[<>&"']/g, '');
      const pinned = pinnedKeysRef.current.has(c.key);
      const markerHtml = markerHtmlOf(titleText, priceText, pinned);
      const marker = new window.naver.maps.Marker({
        position: new window.naver.maps.LatLng(coord.lat, coord.lng),
        icon: {
          content: markerHtml,
          anchor: new window.naver.maps.Point(0, 24),
        },
        zIndex: pinned ? 40 : 20,
      });
      window.naver.maps.Event.addListener(marker, 'click', () => {
        onComplexSelectRef.current?.({ ...c, lat: coord.lat, lng: coord.lng });
      });
      // 지도에 직접 붙이지 않는다 — 클러스터러(격자 묶음)가 줌 레벨에 맞게 보여준다.
      markersRef.current.push({ marker, key: c.key, title: titleText, priceText, pinned });
    }, 6);
    queueServerGeocodeSave(newlyFound);
    if (seq === markerSyncSeqRef.current) { syncNaverClusterer(); reportGeocodeStats(); }
    refineApproxMarkers();
  };

  useEffect(() => {
    // complexes가 처음 들어오거나 지역을 바꿨을 때만 준비한다. 실제 Marker 생성은 near + idle에서 한다.
    if (!mapRef.current || !complexes?.length) return undefined;
    if (zoomTierRef.current === 'near') syncVisibleMarkers();
    else reportGeocodeStats();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complexes]);

  // 지도 이동/확대가 끝난 순간에만 화면 안 단지를 갱신한다.
  useEffect(() => {
    if (!mapRef.current || !window.naver?.maps) return undefined;
    const listener = window.naver.maps.Event.addListener(mapRef.current, 'idle', () => {
      schedulePolygonViewportSync(40);
      if (zoomTierRef.current === 'near') scheduleMarkerSync(40);
      reportViewport();
    });
    return () => {
      if (listener?.remove) listener.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complexes]);

  // 지하철역 레이어 — 화면 범위 안의 역만 부모가 넘겨주므로 단순히 그대로 그린다.
  useEffect(() => {
    if (!mapRef.current || !window.naver?.maps) return undefined;
    stationMarkersRef.current.forEach((m) => m.setMap(null));
    stationMarkersRef.current = [];
    if (!stations || stations.length === 0) return undefined;
    const html = (name) => `
      <div style="display:flex;align-items:center;gap:3px;background:#fff;border:1.5px solid #2F6FE0;border-radius:12px;padding:2px 7px;box-shadow:0 1px 4px rgba(0,0,0,0.2);white-space:nowrap;">
        <span style="font-size:11px;">🚇</span><span style="font-size:10.5px;font-weight:700;color:#2F6FE0;">${name}</span>
      </div>`;
    stations.forEach((s) => {
      const marker = new window.naver.maps.Marker({
        position: new window.naver.maps.LatLng(s.lat, s.lng),
        map: mapRef.current,
        icon: { content: html(s.n), anchor: new window.naver.maps.Point(10, 10) },
        zIndex: 50,
      });
      stationMarkersRef.current.push(marker);
    });
    return () => {
      stationMarkersRef.current.forEach((m) => m.setMap(null));
      stationMarkersRef.current = [];
    };
  }, [stations]);

  // 학교 레이어 — 역과 같은 방식: 화면 범위 안의 학교만 부모가 넘겨주면 그대로 그린다.
  useEffect(() => {
    if (!mapRef.current || !window.naver?.maps) return undefined;
    schoolMarkersRef.current.forEach((m) => m.setMap(null));
    schoolMarkersRef.current = [];
    if (!schools || schools.length === 0) return undefined;
    const html = (name, kind) => `
      <div style="display:flex;align-items:center;gap:3px;background:#fff;border:1.5px solid #2E9E5B;border-radius:12px;padding:2px 7px;box-shadow:0 1px 4px rgba(0,0,0,0.2);white-space:nowrap;">
        <span style="font-size:11px;">🏫</span><span style="font-size:10.5px;font-weight:700;color:#2E9E5B;">${name}${kind ? ` (${kind})` : ''}</span>
      </div>`;
    schools.forEach((s) => {
      const marker = new window.naver.maps.Marker({
        position: new window.naver.maps.LatLng(s.lat, s.lng),
        map: mapRef.current,
        icon: { content: html(s.name, s.kind), anchor: new window.naver.maps.Point(10, 10) },
        zIndex: 49,
      });
      schoolMarkersRef.current.push(marker);
    });
    return () => {
      schoolMarkersRef.current.forEach((m) => m.setMap(null));
      schoolMarkersRef.current = [];
    };
  }, [schools]);

  if (!process.env.NEXT_PUBLIC_NAVER_MAP_KEY_ID) return null;
  if (loadFailed) {
    return (
      <p style={{ fontSize: 12, color: '#B23A2E' }}>
        네이버 지도를 불러오지 못했습니다. 네이버 클라우드 플랫폼 콘솔에서 이 사이트의 Web 서비스 URL이 등록되어 있는지 확인해주세요.
      </p>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div ref={containerRef} style={{ width: '100%', flex: 1, minHeight: 0, borderRadius: 8, overflow: 'hidden', touchAction: 'none' }} />
    </div>
  );
}

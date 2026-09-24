'use client';

import { useEffect, useRef, useState } from 'react';
import { geocodeCache, runPool, fetchServerGeocodeCache, queueServerGeocodeSave } from '../lib/geocodeCache';

// features: [{ feature, name, code }] - 안정적으로 유지되는 배열. values: features와 같은 순서의
// [number|null] 배열로 색상만 자주 바뀔 수 있다. 클릭할 때마다 도형을 다시 그리지 않기 위해 나눴다.
export default function NaverChoropleth({
  features, values, colorFor, borderColor, onSelect, height, focusLatLng, complexes, onComplexSelect,
  dongFeatures, dongValues, onZoomTierChange, onViewportChange,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const polygonsRef = useRef([]); // [{ polygon, featureIndex }] - 구 단위
  const dongPolygonsRef = useRef([]); // [{ polygon, featureIndex }] - 동 단위
  const markersRef = useRef([]); // [{ marker, key }]
  const clustererRef = useRef([]); // [{ overlay }]
  const clusterSignatureRef = useRef('');
  const districtMetaRef = useRef([]);
  const dongMetaRef = useRef([]);
  const polygonSyncTimerRef = useRef(null);
  const kakaoPlacesRef = useRef(null);
  const infoWindowRef = useRef(null);
  const valuesRef = useRef(values);
  const dongValuesRef = useRef(dongValues);
  const colorForRef = useRef(colorFor);
  const onSelectRef = useRef(onSelect);
  const onComplexSelectRef = useRef(onComplexSelect);
  const onZoomTierChangeRef = useRef(onZoomTierChange);
  const onViewportChangeRef = useRef(onViewportChange);
  const [loadFailed, setLoadFailed] = useState(false);
  const markerSyncTimerRef = useRef(null);
  const markerSyncSeqRef = useRef(0);

  useEffect(() => { valuesRef.current = values; }, [values]);
  useEffect(() => { dongValuesRef.current = dongValues; }, [dongValues]);
  useEffect(() => { colorForRef.current = colorFor; }, [colorFor]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onComplexSelectRef.current = onComplexSelect; }, [onComplexSelect]);
  useEffect(() => { onZoomTierChangeRef.current = onZoomTierChange; }, [onZoomTierChange]);
  useEffect(() => { onViewportChangeRef.current = onViewportChange; }, [onViewportChange]);

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
  const NEAR_ZOOM_LEVEL = 15;
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

  const geocodeComplex = (query) => new Promise((resolve) => {
    if (!kakaoPlacesRef.current) return resolve(null);
    kakaoPlacesRef.current.keywordSearch(query, (result, status) => {
      if (status === window.kakao.maps.services.Status.OK && result[0]) {
        resolve({ lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) });
      } else {
        resolve(null);
      }
    });
  });

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
      // near 단계에서는 단지 마커 클릭을 가로채지 않도록 꺼둔다.
      return {
        strokeWeight: 0, strokeOpacity: 0, fillColor: colorForRef.current(value), fillOpacity: 0, clickable: tier === 'mid',
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
    const apply = (items, visible) => items.forEach(({ polygon, bbox }) => {
      const shouldShow = visible && bboxIntersects(bounds, bbox);
      polygon.setMap(shouldShow ? map : null);
    });
    apply(districtMetaRef.current, tier === 'far');
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
    markersRef.current.forEach(({ marker, key }) => {
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
      window.naver.maps.Event.addListener(overlay, 'click', () => {
        map.morph(new window.naver.maps.LatLng(lat, lng), Math.min(map.getZoom() + 2, 19));
      });
      clustererRef.current.push({ overlay });
    });
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
          return value != null ? `${f.name}: ${Math.round(value).toLocaleString()}` : f.name;
        };
        window.naver.maps.Event.addListener(polygon, 'click', () => {
          if (f.code) onSelectRef.current?.(f.code);
        });
        window.naver.maps.Event.addListener(polygon, 'mouseover', (e) => {
          console.log(`[호버] 구 마우스오버: ${f.name}, 현재 티어=${zoomTierRef.current}, 지도에 붙어있음=${!!polygon.getMap()}`);
          if (zoomTierRef.current !== 'far') return;
          const value = valuesRef.current?.[idx];
          const hasValue = value != null;
          polygon.setOptions({ fillOpacity: hasValue ? 0.65 : 0.15, strokeWeight: 2 });
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
          return value != null ? `${f.name}: ${Math.round(value).toLocaleString()}` : f.name;
        };
        window.naver.maps.Event.addListener(polygon, 'click', () => {
          if (f.code) onSelectRef.current?.(f.code);
        });
        window.naver.maps.Event.addListener(polygon, 'mouseover', (e) => {
          const tier = zoomTierRef.current;
          console.log(`[호버] 동 마우스오버: ${f.name}, 현재 티어=${tier}, 지도에 붙어있음=${!!polygon.getMap()}`);
          if (tier === 'far') return;
          const value = dongValuesRef.current?.[idx];
          const hasValue = value != null;
          polygon.setOptions({ fillOpacity: hasValue ? (tier === 'near' ? 0.55 : 0.5) : 0.15, strokeWeight: 2 });
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
      let coord = c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : geocodeCache[c.key];
      if (coord === undefined) {
        if (!ready) return;
        coord = await geocodeComplex(`${c.regionName} ${c.dong} ${c.apt}`)
          || await geocodeComplex(`${c.dong} ${c.apt}`)
          || await geocodeComplex(c.apt);
        geocodeCache[c.key] = coord;
        if (coord) newlyFound.push({ key: c.key, lat: coord.lat, lng: coord.lng });
      }
      if (seq !== markerSyncSeqRef.current || !coord) return;
      const priceText = Number.isFinite(c.latestPrice)
        ? (c.latestPrice >= 10000 ? `${(c.latestPrice / 10000).toFixed(c.latestPrice >= 100000 ? 0 : 1)}억` : `${Math.round(c.latestPrice).toLocaleString()}만`)
        : '';
      const titleText = String(c.apt || '').replace(/[<>&"']/g, '');
      const markerHtml = `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:auto;cursor:pointer;transform:translateY(-2px);">` +
        `<div style="padding:4px 7px;border-radius:8px;background:rgba(255,255,255,0.96);border:1px solid rgba(40,35,30,0.18);box-shadow:0 2px 8px rgba(0,0,0,0.16);font-size:10px;line-height:1.1;white-space:nowrap;color:#2b2722;font-weight:700;">${titleText}${priceText ? `<span style="margin-left:5px;color:#b23a2e;">${priceText}</span>` : ''}</div>` +
        `<div style="width:7px;height:7px;border-radius:50%;background:#b23a2e;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.22);"></div></div>`;
      const marker = new window.naver.maps.Marker({
        position: new window.naver.maps.LatLng(coord.lat, coord.lng),
        icon: {
          content: markerHtml,
          anchor: new window.naver.maps.Point(0, 24),
        },
        zIndex: 20,
      });
      window.naver.maps.Event.addListener(marker, 'click', () => {
        onComplexSelectRef.current?.({ ...c, lat: coord.lat, lng: coord.lng });
      });
      // 지도에 직접 붙이지 않는다 — 클러스터러(격자 묶음)가 줌 레벨에 맞게 보여준다.
      markersRef.current.push({ marker, key: c.key });
    }, 6);
    queueServerGeocodeSave(newlyFound);
    if (seq === markerSyncSeqRef.current) syncNaverClusterer();
  };

  useEffect(() => {
    // complexes가 처음 들어오거나 지역을 바꿨을 때만 준비한다. 실제 Marker 생성은 near + idle에서 한다.
    if (!mapRef.current || !complexes?.length) return undefined;
    if (zoomTierRef.current === 'near') syncVisibleMarkers();
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

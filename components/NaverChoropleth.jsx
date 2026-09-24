'use client';

import { useEffect, useRef, useState } from 'react';
import { geocodeCache, runPool, fetchServerGeocodeCache, queueServerGeocodeSave } from '../lib/geocodeCache';

// features: [{ feature, name, code }] - 안정적으로 유지되는 배열. values: features와 같은 순서의
// [number|null] 배열로 색상만 자주 바뀔 수 있다. 클릭할 때마다 도형을 다시 그리지 않기 위해 나눴다.
export default function NaverChoropleth({
  features, values, colorFor, borderColor, onSelect, height, focusLatLng, complexes, onComplexSelect,
  dongFeatures, dongValues, onZoomTierChange,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const polygonsRef = useRef([]); // [{ polygon, featureIndex }] - 구 단위
  const dongPolygonsRef = useRef([]); // [{ polygon, featureIndex }] - 동 단위
  const markersRef = useRef([]); // [{ marker, key }]
  const clustererRef = useRef([]); // [{ overlay }] - 확대 시 마커들을 묶어 보여주는 그리드 클러스터 오버레이
  const kakaoPlacesRef = useRef(null);
  const infoWindowRef = useRef(null);
  const valuesRef = useRef(values);
  const dongValuesRef = useRef(dongValues);
  const colorForRef = useRef(colorFor);
  const onSelectRef = useRef(onSelect);
  const onComplexSelectRef = useRef(onComplexSelect);
  const onZoomTierChangeRef = useRef(onZoomTierChange);
  const [loadFailed, setLoadFailed] = useState(false);
  const markerSyncTimerRef = useRef(null);
  const markerSyncSeqRef = useRef(0);

  useEffect(() => { valuesRef.current = values; }, [values]);
  useEffect(() => { dongValuesRef.current = dongValues; }, [dongValues]);
  useEffect(() => { colorForRef.current = colorFor; }, [colorFor]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onComplexSelectRef.current = onComplexSelect; }, [onComplexSelect]);
  useEffect(() => { onZoomTierChangeRef.current = onZoomTierChange; }, [onZoomTierChange]);

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
    // 구 색칠은 언제나 유지한다 — "동" 데이터가 없거나 실패해도 지역 선택이 항상 되도록 하는 안전장치.
    polygonsRef.current.forEach(({ polygon }) => polygon.setMap(mapRef.current));
    const tier = zoomTierRef.current;
    dongPolygonsRef.current.forEach(({ polygon }) => polygon.setMap(tier !== 'far' ? mapRef.current : null));
  };

  // 확대(구/단지 단위)하면 색칠은 옅어지다 빠지고 마커가 나타나고, 축소(전체 구역 단위)하면
  // 반대로 색칠은 진해지고 마커는 숨긴다 — 실제 부동산 사이트들과 같은 방식.
  const zoomDebounceRef = useRef(null);

  // 네이버용 클러스터링 — 공식 클러스터러 라이브러리 없이, 지도를 격자로 나눠 겹치는 단지를
  // 하나의 숫자 배지로 묶어 보여준다 (호갱노노/아실처럼). 확대하면 묶음이 풀리면서 개별 마커가 나타난다.
  // handleZoomChangedImmediate가 이 함수를 호출하므로, 반드시 그보다 먼저 선언해야 한다.
  const syncNaverClusterer = () => {
    if (!mapRef.current) return;
    const show = mapRef.current.getZoom() >= NEAR_ZOOM_LEVEL;
    clustererRef.current.forEach(({ overlay }) => overlay.setMap(null));
    clustererRef.current = [];
    if (!show) {
      // 축소하면 개별 마커도 모두 지운다 — 안 그러면 묶음만 지워지고 마커가 남는다.
      markersRef.current.forEach(({ marker }) => marker.setMap(null));
      return;
    }
    const zoom = mapRef.current.getZoom();
    // 격자 크기(도 단위): 확대할수록 작은 격자를 써서 묶음이 자연스럽게 풀리게 한다.
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
        group[0].marker.setMap(mapRef.current);
        return;
      }
      const lat = group.reduce((s, g) => s + g.lat, 0) / group.length;
      const lng = group.reduce((s, g) => s + g.lng, 0) / group.length;
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
      overlay.setMap(mapRef.current);
      // 묶음을 누르면 그 위치로 확대해서 묶음이 풀리게 한다 (여태까진 눌러도 반응이 없었다).
      window.naver.maps.Event.addListener(overlay, 'click', () => {
        mapRef.current.morph(new window.naver.maps.LatLng(lat, lng), Math.min(mapRef.current.getZoom() + 2, 19));
      });
      clustererRef.current.push({ overlay });
    });
  };

  // 줌 중에는 클러스터를 매 프레임 다시 만들지 않고, 잠깐 멈춘 뒤 한 번만 반영한다.
  const scheduleMarkerSync = (delay = 80) => {
    if (markerSyncTimerRef.current) clearTimeout(markerSyncTimerRef.current);
    markerSyncTimerRef.current = setTimeout(() => {
      markerSyncTimerRef.current = null;
      syncNaverClusterer();
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
    if (tier === 'near') syncVisibleMarkers();
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
          if (zoomTierRef.current !== 'far') return;
          const value = valuesRef.current?.[idx];
          const hasValue = value != null;
          polygon.setOptions({ fillOpacity: hasValue ? 0.65 : 0.15, strokeWeight: 2 });
          infoWindowRef.current.setContent(
            `<div style="padding:5px 10px;color:#fff;font-size:12px;white-space:nowrap;">${labelFor()}</div>`,
          );
          infoWindowRef.current.open(mapRef.current, e.coord);
        });
        window.naver.maps.Event.addListener(polygon, 'mousemove', (e) => {
          infoWindowRef.current.setPosition(e.coord);
        });
        window.naver.maps.Event.addListener(polygon, 'mouseout', () => {
          polygon.setOptions(styleFor(idx));
          infoWindowRef.current.close();
        });
        polygonsRef.current.push({ polygon, featureIndex: idx });
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, borderColor]);

  // "동" 단위 도형 생성 — dongFeatures는 선택된 지역의 시/도가 바뀔 때만 갱신되므로 별도 effect로 둔다.
  useEffect(() => {
    if (!mapRef.current || !window.naver?.maps) return undefined;
    console.time('[지도] 동 도형 생성');
    dongPolygonsRef.current.forEach(({ polygon }) => polygon.setMap(null));
    dongPolygonsRef.current = [];
    if (!dongFeatures || dongFeatures.length === 0) { console.timeEnd('[지도] 동 도형 생성'); return undefined; }
    console.log(`[지도] 동 도형 ${dongFeatures.length}개 생성 시작`);

    dongFeatures.forEach((f, idx) => {
      if (!f.feature) return;
      const geomType = f.feature.geometry.type;
      const polys = geomType === 'Polygon' ? [f.feature.geometry.coordinates] : f.feature.geometry.coordinates;

      const allPaths = polys.map((rings) => rings[0].map(([lng, lat]) => new window.naver.maps.LatLng(lat, lng)));
      if (allPaths.length === 0) return;

      const polygon = new window.naver.maps.Polygon({
        map: zoomTierRef.current !== 'far' ? mapRef.current : null,
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
        if (tier === 'far') return;
        const value = dongValuesRef.current?.[idx];
        const hasValue = value != null;
        polygon.setOptions({ fillOpacity: hasValue ? (tier === 'near' ? 0.55 : 0.5) : 0.15, strokeWeight: 2 });
        infoWindowRef.current?.setContent(
          `<div style="padding:5px 10px;color:#fff;font-size:12px;white-space:nowrap;">${labelFor()}</div>`,
        );
        infoWindowRef.current?.open(mapRef.current, e.coord);
      });
      window.naver.maps.Event.addListener(polygon, 'mousemove', (e) => {
        infoWindowRef.current?.setPosition(e.coord);
      });
      window.naver.maps.Event.addListener(polygon, 'mouseout', () => {
        polygon.setOptions(dongStyleFor(idx));
        infoWindowRef.current?.close();
      });
      dongPolygonsRef.current.push({ polygon, featureIndex: idx });
    });
    console.timeEnd('[지도] 동 도형 생성');

    return () => {
      dongPolygonsRef.current.forEach(({ polygon }) => polygon.setMap(null));
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
    const visibleComplexes = complexes.filter((c) => {
      if (c.lat == null || c.lng == null) return false;
      return isInBounds({ lat: c.lat, lng: c.lng }, bounds);
    });
    // 화면 + 여유 영역에서 최대 220개만 Marker화한다.
    const candidate = visibleComplexes.slice(0, 220);
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
      const marker = new window.naver.maps.Marker({
        position: new window.naver.maps.LatLng(coord.lat, coord.lng),
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
      if (zoomTierRef.current === 'near') {
        scheduleMarkerSync(50);
        syncVisibleMarkers();
      }
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

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
  const kakaoPlacesRef = useRef(null);
  const infoWindowRef = useRef(null);
  const valuesRef = useRef(values);
  const dongValuesRef = useRef(dongValues);
  const colorForRef = useRef(colorFor);
  const onSelectRef = useRef(onSelect);
  const onComplexSelectRef = useRef(onComplexSelect);
  const onZoomTierChangeRef = useRef(onZoomTierChange);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => { valuesRef.current = values; }, [values]);
  useEffect(() => { dongValuesRef.current = dongValues; }, [dongValues]);
  useEffect(() => { colorForRef.current = colorFor; }, [colorFor]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onComplexSelectRef.current = onComplexSelect; }, [onComplexSelect]);
  useEffect(() => { onZoomTierChangeRef.current = onZoomTierChange; }, [onZoomTierChange]);

  // 네이버 zoom: 숫자가 클수록 확대된 상태. far는 12 이하(3km+), mid는 13~15(1km 안팎),
  // near는 16 이상(약 300m 이내)에 대응하도록 잡았다.
  const FAR_ZOOM_LEVEL = 11;
  const NEAR_ZOOM_LEVEL = 15;
  const zoomTierRef = useRef('far'); // 'far' | 'mid' | 'near'

  const updateMarkerVisibility = () => {
    if (!mapRef.current) return;
    const show = mapRef.current.getZoom() >= NEAR_ZOOM_LEVEL;
    markersRef.current.forEach(({ marker }) => marker.setMap(show ? mapRef.current : null));
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
      return {
        strokeWeight: 0, strokeOpacity: 0, fillColor: colorForRef.current(value), fillOpacity: 0,
      };
    }
    return {
      strokeWeight: hasValue ? 2 : 0.5,
      strokeColor: borderColor || '#8A8172',
      strokeOpacity: hasValue ? 1 : 0.15,
      fillColor: colorForRef.current(value),
      fillOpacity: hasValue ? 0.32 : 0,
    };
  };

  const dongStyleFor = (idx) => {
    const value = dongValuesRef.current?.[idx];
    const hasValue = value != null;
    const near = zoomTierRef.current === 'near';
    return {
      strokeWeight: hasValue ? 1.5 : 0.4,
      strokeColor: borderColor || '#8A8172',
      strokeOpacity: near ? (hasValue ? 0.35 : 0.06) : (hasValue ? 0.9 : 0.12),
      fillColor: colorForRef.current(value),
      fillOpacity: near ? (hasValue ? 0.07 : 0) : (hasValue ? 0.3 : 0),
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

  const handleZoomChangedImmediate = () => {
    if (!mapRef.current) return;
    const level = mapRef.current.getZoom();
    const tier = level <= FAR_ZOOM_LEVEL ? 'far' : (level >= NEAR_ZOOM_LEVEL ? 'near' : 'mid');
    if (tier !== zoomTierRef.current) {
      console.time('[지도] 줌 전환 재계산');
      zoomTierRef.current = tier;
      applyAllStyles();
      updateLayerVisibility();
      onZoomTierChangeRef.current?.(tier);
      console.timeEnd('[지도] 줌 전환 재계산');
      console.log(`[지도] 구 도형 ${polygonsRef.current.length}개, 동 도형 ${dongPolygonsRef.current.length}개, 마커 ${markersRef.current.length}개`);
    }
    updateMarkerVisibility();
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
          const value = valuesRef.current?.[idx];
          const hasValue = value != null;
          if (zoomTierRef.current === 'far') {
            polygon.setOptions({ fillOpacity: hasValue ? 0.65 : 0.15, strokeWeight: 2 });
          }
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
    console.log(`[지도] 동 도형 새로 생성 시작 (기존 ${dongPolygonsRef.current.length}개 제거, 새 dongFeatures ${dongFeatures?.length ?? 0}개)`);
    console.time('[지도] 동 도형 생성');
    dongPolygonsRef.current.forEach(({ polygon }) => polygon.setMap(null));
    dongPolygonsRef.current = [];
    if (!dongFeatures || dongFeatures.length === 0) { console.timeEnd('[지도] 동 도형 생성'); return undefined; }

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
        const value = dongValuesRef.current?.[idx];
        const hasValue = value != null;
        if (zoomTierRef.current === 'mid') {
          polygon.setOptions({ fillOpacity: hasValue ? 0.5 : 0.12 });
        }
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

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!complexes || !mapRef.current || !window.naver?.maps) return;
      const ready = await ensureKakaoGeocoder();
      if (cancelled || !ready) return;
      if (!kakaoPlacesRef.current) kakaoPlacesRef.current = new window.kakao.maps.services.Places();

      const existingKeys = new Set(markersRef.current.map((m) => m.key));
      const wanted = new Set(complexes.map((c) => c.key));

      markersRef.current = markersRef.current.filter((m) => {
        if (wanted.has(m.key)) return true;
        m.marker.setMap(null);
        return false;
      });

      const todo = complexes.filter((c) => !existingKeys.has(c.key));

      const needServerLookup = todo.filter((c) => geocodeCache[c.key] === undefined).map((c) => c.key);
      if (needServerLookup.length > 0) {
        const serverHits = await fetchServerGeocodeCache(needServerLookup);
        Object.entries(serverHits).forEach(([key, coord]) => { geocodeCache[key] = coord; });
      }

      const newlyFound = [];
      await runPool(todo, async (c) => {
        if (cancelled) return;
        let coord = c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : geocodeCache[c.key];
        if (coord === undefined) {
          coord = await geocodeComplex(`${c.regionName} ${c.dong} ${c.apt}`)
            || await geocodeComplex(`${c.dong} ${c.apt}`)
            || await geocodeComplex(c.apt);
          geocodeCache[c.key] = coord;
          if (coord) newlyFound.push({ key: c.key, lat: coord.lat, lng: coord.lng });
        }
        if (cancelled || !coord) return;
        const marker = new window.naver.maps.Marker({
          position: new window.naver.maps.LatLng(coord.lat, coord.lng),
        });
        window.naver.maps.Event.addListener(marker, 'click', () => {
          onComplexSelectRef.current?.({ ...c, lat: coord.lat, lng: coord.lng });
        });
        marker.setMap(mapRef.current.getZoom() >= NEAR_ZOOM_LEVEL ? mapRef.current : null);
        markersRef.current.push({ marker, key: c.key });
      }, 6);
      queueServerGeocodeSave(newlyFound);

      if (!cancelled) updateMarkerVisibility();
    }
    run();
    return () => { cancelled = true; };
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

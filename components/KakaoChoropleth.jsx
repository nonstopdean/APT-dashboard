'use client';

import { useEffect, useRef, useState } from 'react';
import { geocodeCache, runPool } from '../lib/geocodeCache';

// features: [{ feature, name, code }] - 지오메트리는 안정적으로 유지되는 배열(선택 상태가 바뀌어도
// 배열 자체가 재생성되지 않아야 함). values: features와 같은 순서/길이의 [number|null] 배열로,
// 색상만 자주 바뀔 수 있음. 이렇게 나눠서, 클릭할 때마다 도형을 전부 새로 그리지 않고 색만 바꾼다.
// dongFeatures/dongValues: 같은 모양이지만 "동" 단위 — 중간 확대 단계에서 구 대신 보여준다.
export default function KakaoChoropleth({
  features, values, colorFor, borderColor, onSelect, height, focusLatLng, complexes, onComplexSelect,
  dongFeatures, dongValues,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const polygonsRef = useRef([]); // [{ polygon, featureIndex }] - 구 단위
  const dongPolygonsRef = useRef([]); // [{ polygon, featureIndex }] - 동 단위
  const markersRef = useRef([]); // [{ marker, key }]
  const placesRef = useRef(null);
  const onComplexSelectRef = useRef(onComplexSelect);
  const valuesRef = useRef(values);
  const dongValuesRef = useRef(dongValues);
  const colorForRef = useRef(colorFor);
  const onSelectRef = useRef(onSelect);
  const [caption, setCaption] = useState('지역에 마우스를 올리면 이름이, 클릭하면 비교 목록에 추가됩니다.');
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => { valuesRef.current = values; }, [values]);
  useEffect(() => { dongValuesRef.current = dongValues; }, [dongValues]);
  useEffect(() => { colorForRef.current = colorFor; }, [colorFor]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onComplexSelectRef.current = onComplexSelect; }, [onComplexSelect]);

  const zoomTierRef = useRef('far'); // 'far'(구) | 'mid'(동) | 'near'(동, 연하게 + 마커)

  const styleFor = (idx) => {
    const value = valuesRef.current?.[idx];
    const hasValue = value != null;
    const tier = zoomTierRef.current;
    if (tier !== 'far') {
      // 확대된 상태에서는 구 색칠을 완전히 숨긴다("동" 레이어와 겹쳐서 진해지는 걸 막기 위함).
      // 다만 도형 자체는 지도에 남겨둬서(투명해도) 클릭으로 지역을 고를 수 있게 한다.
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

  // 카카오 레벨: 숫자가 작을수록 확대된 상태. far(구)는 5레벨 이상(3km+), mid(동)는 3~4레벨(1km 안팎),
  // near(동, 연하게+마커)는 2레벨 이하(약 300m 이내)에 대응하도록 잡았다.
  const FAR_ZOOM_LEVEL = 6;
  const NEAR_ZOOM_LEVEL = 3;

  const updateLayerVisibility = () => {
    if (!mapRef.current) return;
    // 구 색칠은 언제나 유지한다(투명도만 tier에 따라 바뀜) — "동" 데이터가 아직 없거나
    // 실패해도 지역 선택/클릭이 항상 되도록 하는 안전장치. "동" 데이터가 있으면 그 위에 덧그린다.
    polygonsRef.current.forEach(({ polygon }) => polygon.setMap(mapRef.current));
    const tier = zoomTierRef.current;
    dongPolygonsRef.current.forEach(({ polygon }) => polygon.setMap(tier !== 'far' ? mapRef.current : null));
  };

  const updateMarkerVisibility = () => {
    if (!mapRef.current) return;
    const show = mapRef.current.getLevel() <= NEAR_ZOOM_LEVEL;
    markersRef.current.forEach(({ marker }) => marker.setMap(show ? mapRef.current : null));
  };

  // 확대하면 구 색칠 -> 동 색칠(진하게) -> 동 색칠(연하게)+마커 순서로 바뀌고,
  // 축소하면 반대로 바뀐다 — 실제 부동산 사이트들과 같은 방식.
  const handleZoomChanged = () => {
    if (!mapRef.current) return;
    const level = mapRef.current.getLevel();
    const tier = level >= FAR_ZOOM_LEVEL ? 'far' : (level <= NEAR_ZOOM_LEVEL ? 'near' : 'mid');
    if (tier !== zoomTierRef.current) {
      zoomTierRef.current = tier;
      applyAllStyles();
      updateLayerVisibility();
    }
    updateMarkerVisibility();
  };

  const geocodeComplex = (query) => new Promise((resolve) => {
    if (!placesRef.current) return resolve(null);
    placesRef.current.keywordSearch(query, (result, status) => {
      if (status === window.kakao.maps.services.Status.OK && result[0]) {
        resolve({ lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) });
      } else {
        resolve(null);
      }
    });
  });

  // 지오메트리(도형) 생성은 features가 실제로 바뀔 때만 실행한다.
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
    if (!key) return undefined;

    let cancelled = false;

    function draw() {
      if (cancelled || !containerRef.current || !window.kakao?.maps) return;

      if (!mapRef.current) {
        mapRef.current = new window.kakao.maps.Map(containerRef.current, {
          center: new window.kakao.maps.LatLng(37.5665, 126.978),
          level: 8,
        });
        if (window.kakao.maps.services) placesRef.current = new window.kakao.maps.services.Places();
        window.kakao.maps.event.addListener(mapRef.current, 'zoom_changed', handleZoomChanged);
      }

      polygonsRef.current.forEach(({ polygon }) => polygon.setMap(null));
      polygonsRef.current = [];

      features.forEach((f, idx) => {
        if (!f.feature) return;
        const geomType = f.feature.geometry.type;
        const polys = geomType === 'Polygon' ? [f.feature.geometry.coordinates] : f.feature.geometry.coordinates;

        polys.forEach((rings) => {
          const path = rings[0].map(([lng, lat]) => new window.kakao.maps.LatLng(lat, lng));
          const polygon = new window.kakao.maps.Polygon({ path, ...styleFor(idx) });
          polygon.setMap(mapRef.current);
          window.kakao.maps.event.addListener(polygon, 'click', () => {
            const value = valuesRef.current?.[idx];
            setCaption(value != null ? `${f.name}: ${Math.round(value).toLocaleString()}` : `${f.name} (클릭하면 비교 목록에 추가됩니다)`);
            if (f.code) onSelectRef.current?.(f.code);
          });
          window.kakao.maps.event.addListener(polygon, 'mouseover', () => {
            const value = valuesRef.current?.[idx];
            const hasValue = value != null;
            if (zoomTierRef.current === 'far') {
              polygon.setOptions({ fillOpacity: hasValue ? 0.5 : 0.12 });
            }
            setCaption(hasValue ? `${f.name}: ${Math.round(value).toLocaleString()}` : f.name);
          });
          window.kakao.maps.event.addListener(polygon, 'mouseout', () => {
            polygon.setOptions(styleFor(idx));
            setCaption('지역에 마우스를 올리면 이름이, 클릭하면 비교 목록에 추가됩니다.');
          });
          polygonsRef.current.push({ polygon, featureIndex: idx });
        });
      });

      applyAllStyles();
      updateLayerVisibility();
    }

    if (window.kakao && window.kakao.maps) {
      window.kakao.maps.load(draw);
    } else {
      let script = document.getElementById('kakao-map-sdk');
      if (!script) {
        script = document.createElement('script');
        script.id = 'kakao-map-sdk';
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false&libraries=services`;
        script.async = true;
        script.onerror = () => { if (!cancelled) setLoadFailed(true); };
        document.head.appendChild(script);
      }
      script.addEventListener('load', () => {
        if (!cancelled && window.kakao && window.kakao.maps) window.kakao.maps.load(draw);
      });
      if (window.kakao && window.kakao.maps) window.kakao.maps.load(draw);
    }

    return () => {
      cancelled = true;
      polygonsRef.current.forEach(({ polygon }) => polygon.setMap(null));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, borderColor]);

  // "동" 단위 도형 생성 — dongFeatures는 선택된 지역의 시/도가 바뀔 때만 갱신되므로 별도 effect로 둔다.
  useEffect(() => {
    if (!mapRef.current || !window.kakao?.maps) return undefined;
    dongPolygonsRef.current.forEach(({ polygon }) => polygon.setMap(null));
    dongPolygonsRef.current = [];
    if (!dongFeatures || dongFeatures.length === 0) return undefined;

    dongFeatures.forEach((f, idx) => {
      if (!f.feature) return;
      const geomType = f.feature.geometry.type;
      const polys = geomType === 'Polygon' ? [f.feature.geometry.coordinates] : f.feature.geometry.coordinates;

      polys.forEach((rings) => {
        const path = rings[0].map(([lng, lat]) => new window.kakao.maps.LatLng(lat, lng));
        const polygon = new window.kakao.maps.Polygon({ path, ...dongStyleFor(idx) });
        polygon.setMap(zoomTierRef.current !== 'far' ? mapRef.current : null);
        window.kakao.maps.event.addListener(polygon, 'click', () => {
          const value = dongValuesRef.current?.[idx];
          setCaption(value != null ? `${f.name}: ${Math.round(value).toLocaleString()}` : f.name);
          if (f.code) onSelectRef.current?.(f.code);
        });
        window.kakao.maps.event.addListener(polygon, 'mouseover', () => {
          const value = dongValuesRef.current?.[idx];
          const hasValue = value != null;
          if (zoomTierRef.current === 'mid') {
            polygon.setOptions({ fillOpacity: hasValue ? 0.5 : 0.12 });
          }
          setCaption(hasValue ? `${f.name}: ${Math.round(value).toLocaleString()}` : f.name);
        });
        window.kakao.maps.event.addListener(polygon, 'mouseout', () => {
          polygon.setOptions(dongStyleFor(idx));
          setCaption('지역에 마우스를 올리면 이름이, 클릭하면 비교 목록에 추가됩니다.');
        });
        dongPolygonsRef.current.push({ polygon, featureIndex: idx });
      });
    });

    return () => {
      dongPolygonsRef.current.forEach(({ polygon }) => polygon.setMap(null));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dongFeatures, borderColor]);

  // 값(색상)만 바뀔 때는 기존 도형의 옵션만 갱신한다 (재생성 없음 -> 클릭/선택이 즉각 반응).
  useEffect(() => {
    applyAllStyles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, colorFor]);

  useEffect(() => {
    if (!focusLatLng || !mapRef.current || !window.kakao?.maps) return;
    const latlng = new window.kakao.maps.LatLng(focusLatLng.lat, focusLatLng.lng);
    mapRef.current.panTo(latlng);
    mapRef.current.setLevel(5);
  }, [focusLatLng]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!complexes || !mapRef.current || !window.kakao?.maps?.services) return;
      if (!placesRef.current) placesRef.current = new window.kakao.maps.services.Places();

      const existingKeys = new Set(markersRef.current.map((m) => m.key));
      const wanted = new Set(complexes.map((c) => c.key));

      // 더 이상 필요 없는 마커는 지운다
      markersRef.current = markersRef.current.filter((m) => {
        if (wanted.has(m.key)) return true;
        m.marker.setMap(null);
        return false;
      });

      const todo = complexes.filter((c) => !existingKeys.has(c.key));

      await runPool(todo, async (c) => {
        if (cancelled) return;
        let coord = geocodeCache[c.key];
        if (coord === undefined) {
          coord = await geocodeComplex(`${c.regionName} ${c.dong} ${c.apt}`)
            || await geocodeComplex(`${c.dong} ${c.apt}`)
            || await geocodeComplex(c.apt);
          geocodeCache[c.key] = coord;
        }
        if (cancelled || !coord) return;
        const marker = new window.kakao.maps.Marker({
          position: new window.kakao.maps.LatLng(coord.lat, coord.lng),
        });
        window.kakao.maps.event.addListener(marker, 'click', () => {
          onComplexSelectRef.current?.({ ...c, lat: coord.lat, lng: coord.lng });
        });
        // 새로 생긴 마커는 현재 확대 상태에 맞춰 바로 보이거나 숨겨지게만 설정하고,
        // 전체 마커를 다시 훑는 건 다 끝난 뒤 한 번만 한다 (그렇지 않으면 개수가 많을 때 버벅인다).
        marker.setMap(mapRef.current.getLevel() <= NEAR_ZOOM_LEVEL ? mapRef.current : null);
        markersRef.current.push({ marker, key: c.key });
      }, 6);

      if (!cancelled) updateMarkerVisibility();
    }
    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complexes]);

  if (!process.env.NEXT_PUBLIC_KAKAO_MAP_KEY) return null;
  if (loadFailed) {
    return (
      <p style={{ fontSize: 12, color: '#B23A2E' }}>
        카카오맵을 불러오지 못했습니다. Kakao Developers에서 이 사이트 도메인이 허용되어 있는지 확인해주세요.
      </p>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div ref={containerRef} style={{ width: '100%', flex: 1, minHeight: 0, borderRadius: 8, overflow: 'hidden', touchAction: 'none' }} />
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';

// features: [{ feature, name, code }] - 안정적으로 유지되는 배열. values: features와 같은 순서의
// [number|null] 배열로 색상만 자주 바뀔 수 있다. 클릭할 때마다 도형을 다시 그리지 않기 위해 나눴다.
export default function NaverChoropleth({ features, values, colorFor, borderColor, onSelect, height, focusLatLng, complexes, onComplexSelect }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const polygonsRef = useRef([]); // [{ polygon, featureIndex }]
  const markersRef = useRef([]); // [{ marker, key }]
  const geocodeCacheRef = useRef({}); // key -> {lat,lng} | null
  const kakaoPlacesRef = useRef(null);
  const infoWindowRef = useRef(null);
  const valuesRef = useRef(values);
  const colorForRef = useRef(colorFor);
  const onSelectRef = useRef(onSelect);
  const onComplexSelectRef = useRef(onComplexSelect);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => { valuesRef.current = values; }, [values]);
  useEffect(() => { colorForRef.current = colorFor; }, [colorFor]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onComplexSelectRef.current = onComplexSelect; }, [onComplexSelect]);

  const MARKER_ZOOM_LEVEL = 13; // 네이버 zoom: 숫자가 클수록 확대된 상태

  const updateMarkerVisibility = () => {
    if (!mapRef.current) return;
    const show = mapRef.current.getZoom() >= MARKER_ZOOM_LEVEL;
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
    return {
      strokeWeight: hasValue ? 1.5 : 0.5,
      strokeColor: borderColor || '#DEDBCF',
      strokeOpacity: hasValue ? 0.9 : 0.15,
      fillColor: colorForRef.current(value),
      fillOpacity: hasValue ? 0.32 : 0,
    };
  };

  const applyAllStyles = () => {
    polygonsRef.current.forEach(({ polygon, featureIndex }) => {
      polygon.setOptions(styleFor(featureIndex));
    });
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
        window.naver.maps.Event.addListener(mapRef.current, 'zoom_changed', updateMarkerVisibility);
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

        polys.forEach((rings) => {
          const path = rings[0].map(([lng, lat]) => new window.naver.maps.LatLng(lat, lng));
          const polygon = new window.naver.maps.Polygon({
            map: mapRef.current,
            paths: [path],
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
      });

      applyAllStyles();
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

      for (const c of complexes) {
        if (cancelled) return;
        if (existingKeys.has(c.key)) continue;
        let coord = geocodeCacheRef.current[c.key];
        if (coord === undefined) {
          // eslint-disable-next-line no-await-in-loop
          coord = await geocodeComplex(`${c.regionName} ${c.dong} ${c.apt}`)
            || await geocodeComplex(`${c.dong} ${c.apt}`)
            || await geocodeComplex(c.apt);
          geocodeCacheRef.current[c.key] = coord;
        }
        if (cancelled || !coord) continue;
        const marker = new window.naver.maps.Marker({
          position: new window.naver.maps.LatLng(coord.lat, coord.lng),
        });
        window.naver.maps.Event.addListener(marker, 'click', () => {
          onComplexSelectRef.current?.(c);
        });
        markersRef.current.push({ marker, key: c.key });
      }
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

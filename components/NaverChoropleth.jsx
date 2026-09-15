'use client';

import { useEffect, useRef, useState } from 'react';

// features: [{ feature, name, code }] - 안정적으로 유지되는 배열. values: features와 같은 순서의
// [number|null] 배열로 색상만 자주 바뀔 수 있다. 클릭할 때마다 도형을 다시 그리지 않기 위해 나눴다.
export default function NaverChoropleth({ features, values, colorFor, borderColor, onSelect, height, focusLatLng }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const polygonsRef = useRef([]); // [{ polygon, featureIndex }]
  const infoWindowRef = useRef(null);
  const valuesRef = useRef(values);
  const colorForRef = useRef(colorFor);
  const onSelectRef = useRef(onSelect);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => { valuesRef.current = values; }, [values]);
  useEffect(() => { colorForRef.current = colorFor; }, [colorFor]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  const styleFor = (idx) => {
    const value = valuesRef.current?.[idx];
    const hasValue = value != null;
    return {
      strokeWeight: hasValue ? 1.5 : 0.5,
      strokeColor: borderColor || '#DEDBCF',
      strokeOpacity: hasValue ? 0.9 : 0.15,
      fillColor: colorForRef.current(value),
      fillOpacity: hasValue ? 0.55 : 0,
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
            polygon.setOptions({ fillColor: '#F2B441', fillOpacity: 0.75, strokeColor: '#B23A2E', strokeWeight: 2 });
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

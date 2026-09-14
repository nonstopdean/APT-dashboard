'use client';

import { useEffect, useRef, useState } from 'react';

export default function NaverChoropleth({ features, colorFor, borderColor, onSelect, height }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const polygonsRef = useRef([]);
  const [caption, setCaption] = useState('지역에 마우스를 올리면 이름이, 클릭하면 비교 목록에 추가됩니다.');
  const [loadFailed, setLoadFailed] = useState(false);

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

      polygonsRef.current.forEach((p) => p.setMap(null));
      polygonsRef.current = [];

      features.forEach(({ feature, name, value, code }) => {
        if (!feature) return;
        const geomType = feature.geometry.type;
        const polygons = geomType === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;

        polygons.forEach((rings) => {
          const path = rings[0].map(([lng, lat]) => new window.naver.maps.LatLng(lat, lng));
          const hasValue = value != null;
          const baseFillOpacity = hasValue ? 0.55 : 0;
          const polygon = new window.naver.maps.Polygon({
            map: mapRef.current,
            paths: [path],
            strokeWeight: hasValue ? 1.5 : 0.5,
            strokeColor: borderColor || '#DEDBCF',
            strokeOpacity: hasValue ? 0.9 : 0.15,
            fillColor: colorFor(value),
            fillOpacity: baseFillOpacity,
            clickable: true,
          });
          window.naver.maps.Event.addListener(polygon, 'click', () => {
            setCaption(value != null ? `${name}: ${Math.round(value).toLocaleString()}` : `${name}: 검색되지 않은 지역 (클릭하면 추가됩니다)`);
            if (code) onSelect?.(code);
          });
          window.naver.maps.Event.addListener(polygon, 'mouseover', () => {
            polygon.setOptions({ fillOpacity: hasValue ? 0.7 : 0.12 });
            setCaption(hasValue ? `${name}: ${Math.round(value).toLocaleString()}` : `${name} (검색되지 않은 지역)`);
          });
          window.naver.maps.Event.addListener(polygon, 'mouseout', () => {
            polygon.setOptions({ fillOpacity: baseFillOpacity });
            setCaption('지역에 마우스를 올리면 이름이, 클릭하면 비교 목록에 추가됩니다.');
          });
          polygonsRef.current.push(polygon);
        });
      });
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
      polygonsRef.current.forEach((p) => p.setMap(null));
    };
  }, [features, colorFor, borderColor, onSelect]);

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
      <div ref={containerRef} style={{ width: '100%', flex: 1, minHeight: 0, borderRadius: 8, overflow: 'hidden' }} />
      <p style={{ fontSize: 12, color: '#5C594E', marginTop: 8, flexShrink: 0 }}>{caption}</p>
    </div>
  );
}

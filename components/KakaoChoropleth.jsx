'use client';

import { useEffect, useRef, useState } from 'react';

export default function KakaoChoropleth({ features, colorFor, borderColor, onSelect, height }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const polygonsRef = useRef([]);
  const [caption, setCaption] = useState('지역을 클릭하면 값이 여기 표시됩니다.');
  const [loadFailed, setLoadFailed] = useState(false);

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
      }

      polygonsRef.current.forEach((p) => p.setMap(null));
      polygonsRef.current = [];

      features.forEach(({ feature, name, value, code }) => {
        if (!feature) return;
        const geomType = feature.geometry.type;
        const polygons = geomType === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;

        polygons.forEach((rings) => {
          const path = rings[0].map(([lng, lat]) => new window.kakao.maps.LatLng(lat, lng));
          const polygon = new window.kakao.maps.Polygon({
            path,
            strokeWeight: 1,
            strokeColor: borderColor || '#DEDBCF',
            strokeOpacity: 0.9,
            fillColor: colorFor(value),
            fillOpacity: 0.72,
          });
          polygon.setMap(mapRef.current);
          window.kakao.maps.event.addListener(polygon, 'click', () => {
            setCaption(value != null ? `${name}: ${Math.round(value).toLocaleString()}` : `${name}: 데이터 없음`);
            if (code) onSelect?.(code);
          });
          window.kakao.maps.event.addListener(polygon, 'mouseover', () => {
            polygon.setOptions({ fillOpacity: 0.9 });
          });
          window.kakao.maps.event.addListener(polygon, 'mouseout', () => {
            polygon.setOptions({ fillOpacity: 0.72 });
          });
          polygonsRef.current.push(polygon);
        });
      });
    }

    if (window.kakao && window.kakao.maps) {
      window.kakao.maps.load(draw);
    } else {
      let script = document.getElementById('kakao-map-sdk');
      if (!script) {
        script = document.createElement('script');
        script.id = 'kakao-map-sdk';
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false`;
        script.async = true;
        script.onerror = () => { if (!cancelled) setLoadFailed(true); };
        document.head.appendChild(script);
      }
      script.addEventListener('load', () => {
        if (!cancelled && window.kakao && window.kakao.maps) window.kakao.maps.load(draw);
      });
      // 스크립트가 이미 로드 완료된 상태에서 재마운트된 경우 대비
      if (window.kakao && window.kakao.maps) window.kakao.maps.load(draw);
    }

    return () => {
      cancelled = true;
      polygonsRef.current.forEach((p) => p.setMap(null));
    };
  }, [features, colorFor, borderColor, onSelect]);

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
      <div ref={containerRef} style={{ width: '100%', flex: 1, minHeight: 0, borderRadius: 8, overflow: 'hidden' }} />
      <p style={{ fontSize: 12, color: '#5C594E', marginTop: 8, flexShrink: 0 }}>{caption}</p>
    </div>
  );
}

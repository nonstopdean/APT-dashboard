'use client';

import { useEffect, useRef, useState } from 'react';
import { geocodeCache, runPool, fetchServerGeocodeCache, queueServerGeocodeSave } from '../lib/geocodeCache';

// features: [{ feature, name, code }] - 지오메트리는 안정적으로 유지되는 배열(선택 상태가 바뀌어도
// 배열 자체가 재생성되지 않아야 함). values: features와 같은 순서/길이의 [number|null] 배열로,
// 색상만 자주 바뀔 수 있음. 이렇게 나눠서, 클릭할 때마다 도형을 전부 새로 그리지 않고 색만 바꾼다.
// dongFeatures/dongValues: 같은 모양이지만 "동" 단위 — 중간 확대 단계에서 구 대신 보여준다.
// v222: 네이버 지도와 기능 맞추기 — 지도 범위 알림(현재 화면 목록·역/학교 표시에 필요), 지하철역·학교 표시,
// 단지 핀에 이름·가격(핀 가격 기준)·비교함 ★. (네이버 키가 있으면 이 지도는 안 쓰인다. 확인은 주소 끝에 ?map=kakao)
const EMPTY_KEYS = new Set();
const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
function fmtPinPrice(v) {
  if (!Number.isFinite(v)) return '';
  return v >= 10000 ? `${(v / 10000).toFixed(1).replace(/\.0$/, '')}억` : `${Math.round(v).toLocaleString()}만`;
}
function pinPriceTextOf(c, mode) {
  if (mode === 'unit') return Number.isFinite(c.latestPyeong) ? `${Math.round(c.latestPyeong).toLocaleString()}만/평` : '';
  if (mode === 'p34') return fmtPinPrice(c.latest34Price);
  return fmtPinPrice(c.latestPrice);
}
function pinHtml(c, mode, pinned) {
  const price = pinPriceTextOf(c, mode);
  const border = pinned ? '2px solid #b23a2e' : '1px solid rgba(40,35,30,0.18)';
  const bg = pinned ? '#fff4ef' : 'rgba(255,255,255,0.96)';
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;">`
    + `<div style="padding:4px 7px;border-radius:8px;background:${bg};border:${border};box-shadow:0 2px 8px rgba(0,0,0,0.16);font-size:10px;line-height:1.1;white-space:nowrap;color:#2b2722;font-weight:700;">`
    + `${pinned ? '<span style="margin-right:3px;color:#b23a2e;">★</span>' : ''}${escHtml(c.apt)}${price ? `<span style="margin-left:5px;color:#b23a2e;">${escHtml(price)}</span>` : ''}</div>`
    + '<div style="width:7px;height:7px;border-radius:50%;background:#b23a2e;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.22);"></div></div>';
}
const layerHtml = (icon, text, color) => `<div style="display:flex;align-items:center;gap:3px;background:#fff;border:1.5px solid ${color};border-radius:12px;padding:2px 7px;box-shadow:0 1px 4px rgba(0,0,0,0.2);white-space:nowrap;">`
  + `<span style="font-size:11px;">${icon}</span><span style="font-size:10.5px;font-weight:700;color:${color};">${escHtml(text)}</span></div>`;

export default function KakaoChoropleth({
  features, values, colorFor, borderColor, onSelect, height, focusLatLng, complexes, onComplexSelect,
  dongFeatures, dongValues, onZoomTierChange,
  onViewportChange, onVisibleMarkerCount, stations, schools, pinnedKeys = EMPTY_KEYS, pinPriceMode = 'deal',
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const polygonsRef = useRef([]); // [{ polygon, featureIndex }] - 구 단위
  const dongPolygonsRef = useRef([]); // [{ polygon, featureIndex }] - 동 단위
  const markersRef = useRef([]); // [{ marker, key }]
  const clustererRef = useRef(null); // 단지 마커 클러스터러 (아실/호갱노노처럼 겹치는 단지를 묶어서 보여줌)
  const placesRef = useRef(null);
  const onComplexSelectRef = useRef(onComplexSelect);
  const complexesRef = useRef(complexes);
  const onZoomTierChangeRef = useRef(onZoomTierChange);
  const valuesRef = useRef(values);
  const dongValuesRef = useRef(dongValues);
  const colorForRef = useRef(colorFor);
  const onSelectRef = useRef(onSelect);
  const [caption, setCaption] = useState('지역에 마우스를 올리면 이름이, 클릭하면 비교 목록에 추가됩니다.');
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => { valuesRef.current = values; }, [values]);
  useEffect(() => { dongValuesRef.current = dongValues; }, [dongValues]);
  useEffect(() => { onZoomTierChangeRef.current = onZoomTierChange; }, [onZoomTierChange]);
  useEffect(() => { colorForRef.current = colorFor; }, [colorFor]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onComplexSelectRef.current = onComplexSelect; }, [onComplexSelect]);
  useEffect(() => { complexesRef.current = complexes; }, [complexes]);
  // v222: 지도 범위·화면 안 핀 수 알림, 핀 모양(가격 기준·★), 역·학교 표시
  const onViewportChangeRef = useRef(onViewportChange);
  const onVisibleMarkerCountRef = useRef(onVisibleMarkerCount);
  const pinPriceModeRef = useRef(pinPriceMode);
  const pinnedKeysRef = useRef(pinnedKeys);
  const stationOverlaysRef = useRef([]);
  const schoolOverlaysRef = useRef([]);
  const [mapReady, setMapReady] = useState(0);
  useEffect(() => { onViewportChangeRef.current = onViewportChange; }, [onViewportChange]);
  useEffect(() => { onVisibleMarkerCountRef.current = onVisibleMarkerCount; }, [onVisibleMarkerCount]);
  const reportViewport = () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();
    if (onViewportChangeRef.current) onViewportChangeRef.current({ swLat: sw.getLat(), swLng: sw.getLng(), neLat: ne.getLat(), neLng: ne.getLng() });
    if (onVisibleMarkerCountRef.current) {
      const near = map.getLevel() <= NEAR_ZOOM_LEVEL;
      const n = near ? markersRef.current.filter(({ marker }) => b.contain(marker.getPosition())).length : 0;
      onVisibleMarkerCountRef.current(n);
    }
  };
  const reportViewportRef = useRef(reportViewport);
  reportViewportRef.current = reportViewport;
  // 핀 글자만 다시 쓴다(가격 기준·비교함이 바뀔 때). 마커를 새로 만들지 않는다.
  const refreshPinTexts = () => {
    markersRef.current.forEach((m) => {
      if (m.el && m.c) m.el.innerHTML = pinHtml(m.c, pinPriceModeRef.current, pinnedKeysRef.current.has(m.key));
    });
  };
  useEffect(() => {
    pinPriceModeRef.current = pinPriceMode;
    pinnedKeysRef.current = pinnedKeys || EMPTY_KEYS;
    refreshPinTexts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinPriceMode, pinnedKeys]);

  const zoomTierRef = useRef('far'); // 'far'(구) | 'mid'(동) | 'near'(동, 연하게 + 마커)

  const styleFor = (idx) => {
    const value = valuesRef.current?.[idx];
    const hasValue = value != null;
    const tier = zoomTierRef.current;
    if (tier !== 'far') {
      // 확대된 상태에서는 구 색칠을 완전히 숨긴다. "동" 데이터가 비어있는 구간에서는 동을
      // 눌러도 반응이 없을 수 있으므로, near(마커 활성) 단계가 아닐 때는 이 투명한 구 도형을
      // 계속 클릭 가능하게 남겨서 "구를 고르는" 동작이 항상 되게 한다. near 단계에서는
      // 단지 마커 클릭을 가로채지 않도록 꺼두는 게 원칙이지만, 마커가 하나도 없으면
      // (아직 아무 지역도 선택 안 함) 가로챌 게 없으므로 계속 클릭 가능하게 둔다.
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

  // 카카오 레벨: 숫자가 작을수록 확대된 상태. far(구)는 5레벨 이상(3km+), mid(동)는 3~4레벨(1km 안팎),
  // near(동, 연하게+마커)는 2레벨 이하(약 300m 이내)에 대응하도록 잡았다.
  const FAR_ZOOM_LEVEL = 5;
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
  const zoomDebounceRef = useRef(null);

  // 마커는 항상 클러스터러가 관리한다. 넓게 볼 때는 겹치는 단지가 하나의 클러스터로 묶이고,
  // 가까이 확대하면 클러스터가 풀리면서 단지 하나하나가 마커로 보인다 — 실제 부동산 앱들과 같은 방식.
  const syncClusterer = () => {
    if (!mapRef.current || !window.kakao?.maps?.MarkerClusterer) return;
    if (!clustererRef.current) {
      clustererRef.current = new window.kakao.maps.MarkerClusterer({
        map: mapRef.current,
        markers: [],
        gridSize: 60,
        averageCenter: true,
        // 이 레벨보다 확대되면(레벨 3 아래) 클러스터가 풀리면서 개별 마커가 나타난다.
        minLevel: NEAR_ZOOM_LEVEL,
        calculator: (size) => (size < 10 ? 0 : size < 50 ? 1 : 2),
        styles: [
          { width: 38, height: 38, borderRadius: 19, background: 'rgba(178,58,46,0.88)', color: '#fff', textAlign: 'center', fontWeight: 700, fontSize: 12, lineHeight: '38px' },
          { width: 48, height: 48, borderRadius: 24, background: 'rgba(178,58,46,0.92)', color: '#fff', textAlign: 'center', fontWeight: 700, fontSize: 13, lineHeight: '48px' },
          { width: 60, height: 60, borderRadius: 30, background: 'rgba(122,34,26,0.94)', color: '#fff', textAlign: 'center', fontWeight: 800, fontSize: 14, lineHeight: '60px' },
        ],
      });
    }
    clustererRef.current.clear();
    const all = markersRef.current.map((m) => m.marker);
    if (all.length > 0) clustererRef.current.addMarkers(all);
  };

  const handleZoomChangedImmediate = () => {
    if (!mapRef.current) return;
    const level = mapRef.current.getLevel();
    const tier = level >= FAR_ZOOM_LEVEL ? 'far' : (level <= NEAR_ZOOM_LEVEL ? 'near' : 'mid');
    if (tier !== zoomTierRef.current) {
      zoomTierRef.current = tier;
      applyAllStyles();
      updateLayerVisibility();
      onZoomTierChangeRef.current?.(tier);
    }
  };

  // 줌 도중(스크롤/핀치 중) 매 프레임마다 도형 수백 개를 다시 그리면 버벅이므로,
  // 줌이 실제로 멈춘 뒤 한 번만 무거운 재계산을 하도록 살짝 지연시킨다.
  const handleZoomChanged = () => {
    if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
    zoomDebounceRef.current = setTimeout(handleZoomChangedImmediate, 150);
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
        // 지도가 멈출 때마다 범위를 알린다(ref 경유 — 지도 이벤트에 렌더 때의 함수를 직접 넘기지 않는다, v169 교훈).
        window.kakao.maps.event.addListener(mapRef.current, 'idle', () => reportViewportRef.current());
        setMapReady((v) => v + 1);
      }

      polygonsRef.current.forEach(({ polygon }) => polygon.setMap(null));
      polygonsRef.current = [];

      features.forEach((f, idx) => {
        if (!f.feature) return;
        const geomType = f.feature.geometry.type;
        const polys = geomType === 'Polygon' ? [f.feature.geometry.coordinates] : f.feature.geometry.coordinates;
        // 섬이 많은 지역(전남/경남/인천 등)은 하나의 시/군/구가 수십~수백 개의 조각(섬)으로
        // 이루어져 있다. 조각마다 별개의 Polygon 객체를 만들면 전국 기준 250개가 아니라
        // 수만 개가 생겨서 줌마다 다시 칠하는 비용이 폭발한다 — 카카오 Polygon의 path는
        // 이차원 배열을 지원하므로, 조각들을 한 Polygon 객체로 합쳐서 "지역당 객체 1개"를 유지한다.
        const allPaths = polys.map((rings) => rings[0].map(([lng, lat]) => new window.kakao.maps.LatLng(lat, lng)));
        if (allPaths.length === 0) return;

        const polygon = new window.kakao.maps.Polygon({ path: allPaths, ...styleFor(idx) });
        polygon.setMap(mapRef.current);
        window.kakao.maps.event.addListener(polygon, 'click', () => {
          const value = valuesRef.current?.[idx];
          setCaption(value != null ? `${f.name}: ${Math.round(value).toLocaleString()}` : `${f.name} (클릭하면 비교 목록에 추가됩니다)`);
          if (f.code) onSelectRef.current?.(f.code);
        });
        window.kakao.maps.event.addListener(polygon, 'mouseover', () => {
          if (zoomTierRef.current !== 'far') return;
          const value = valuesRef.current?.[idx];
          const hasValue = value != null;
          polygon.setOptions({ fillOpacity: hasValue ? 0.5 : 0.12 });
          setCaption(hasValue ? `${f.name}: ${Math.round(value).toLocaleString()}` : f.name);
        });
        window.kakao.maps.event.addListener(polygon, 'mouseout', () => {
          polygon.setOptions(styleFor(idx));
          setCaption('지역에 마우스를 올리면 이름이, 클릭하면 비교 목록에 추가됩니다.');
        });
        polygonsRef.current.push({ polygon, featureIndex: idx });
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
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false&libraries=services,clusterer`;
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

      const allPaths = polys.map((rings) => rings[0].map(([lng, lat]) => new window.kakao.maps.LatLng(lat, lng)));
      if (allPaths.length === 0) return;

      const polygon = new window.kakao.maps.Polygon({ path: allPaths, ...dongStyleFor(idx) });
      polygon.setMap(zoomTierRef.current !== 'far' ? mapRef.current : null);
      window.kakao.maps.event.addListener(polygon, 'click', () => {
        const value = dongValuesRef.current?.[idx];
        setCaption(value != null ? `${f.name}: ${Math.round(value).toLocaleString()}` : f.name);
        if (f.code) onSelectRef.current?.(f.code);
      });
      window.kakao.maps.event.addListener(polygon, 'mouseover', () => {
        const value = dongValuesRef.current?.[idx];
        const hasValue = value != null;
        if (zoomTierRef.current !== 'far') {
          polygon.setOptions({ fillOpacity: hasValue ? 0.5 : 0.15 });
        }
        setCaption(hasValue ? `${f.name}: ${Math.round(value).toLocaleString()}` : f.name);
      });
      window.kakao.maps.event.addListener(polygon, 'mouseout', () => {
        polygon.setOptions(dongStyleFor(idx));
        setCaption('지역에 마우스를 올리면 이름이, 클릭하면 비교 목록에 추가됩니다.');
      });
      dongPolygonsRef.current.push({ polygon, featureIndex: idx });
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

      // 남은 핀은 새 값(기간이 바뀌면 가격도 바뀐다)으로 글자만 다시 쓴다.
      const byKey = new Map(complexes.map((c) => [c.key, c]));
      markersRef.current.forEach((m) => {
        const nc = byKey.get(m.key);
        if (nc && nc !== m.c) {
          m.c = nc;
          if (m.el) m.el.innerHTML = pinHtml(nc, pinPriceModeRef.current, pinnedKeysRef.current.has(m.key));
        }
      });

      const todo = complexes.filter((c) => !existingKeys.has(c.key));

      // 아직 메모리 캐시에 없는 것들은 서버(Vercel KV)에 이미 저장된 좌표가 있는지 먼저 물어본다 —
      // 다른 방문자가 이미 찾아둔 단지라면 카카오에 다시 검색하지 않고 바로 쓸 수 있다.
      const needServerLookup = todo.filter((c) => geocodeCache[c.key] === undefined).map((c) => c.key);
      if (needServerLookup.length > 0) {
        const serverHits = await fetchServerGeocodeCache(needServerLookup);
        Object.entries(serverHits).forEach(([key, coord]) => { geocodeCache[key] = coord; });
      }

      const newlyFound = [];
      await runPool(todo, async (c) => {
        if (cancelled) return;
        // 이미 "동" 중심점 좌표가 있으면(page.jsx에서 넘겨줌) 카카오 검색 자체를 건너뛴다 — 이게 훨씬 빠르다.
        let coord = c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : geocodeCache[c.key];
        if (coord === undefined) {
          coord = await geocodeComplex(`${c.regionName} ${c.dong} ${c.apt}`)
            || await geocodeComplex(`${c.dong} ${c.apt}`)
            || await geocodeComplex(c.apt);
          geocodeCache[c.key] = coord;
          if (coord) newlyFound.push({ key: c.key, lat: coord.lat, lng: coord.lng });
        }
        if (cancelled || !coord) return;
        // v222: 기본 마커 대신 이름·가격이 적힌 핀(네이버 지도와 같은 모양, 비교함은 ★). 클러스터러는 커스텀 오버레이도 묶는다.
        const el = document.createElement('div');
        el.innerHTML = pinHtml(c, pinPriceModeRef.current, pinnedKeysRef.current.has(c.key));
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onComplexSelectRef.current?.({ ...c, lat: coord.lat, lng: coord.lng });
        });
        const marker = new window.kakao.maps.CustomOverlay({
          position: new window.kakao.maps.LatLng(coord.lat, coord.lng), content: el, yAnchor: 1, clickable: true,
        });
        // 지도에 직접 붙이지 않고 클러스터러가 보여주도록 둔다 — 줌 레벨에 따라
        // 클러스터(묶음) <-> 개별 마커 전환은 클러스터러가 알아서 한다.
        markersRef.current.push({ marker, key: c.key, el, c });
      }, 6);
      queueServerGeocodeSave(newlyFound);

      if (!cancelled) { syncClusterer(); reportViewport(); }
    }
    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complexes, mapReady]);

  // v222: 지하철역·학교 표시 — 화면 범위 안의 것만 부모가 넘겨주므로 그대로 그린다(네이버 지도와 같은 방식).
  const drawLayer = (ref, items, toHtml, zIndex) => {
    ref.current.forEach((o) => o.setMap(null));
    ref.current = [];
    if (!mapRef.current || !window.kakao?.maps || !items || items.length === 0) return;
    items.forEach((s) => {
      const o = new window.kakao.maps.CustomOverlay({
        position: new window.kakao.maps.LatLng(s.lat, s.lng), content: toHtml(s), xAnchor: 0.15, yAnchor: 0.5, zIndex,
      });
      o.setMap(mapRef.current);
      ref.current.push(o);
    });
  };
  useEffect(() => {
    drawLayer(stationOverlaysRef, stations, (s) => layerHtml('🚇', s.n, '#2F6FE0'), 5);
    return () => { stationOverlaysRef.current.forEach((o) => o.setMap(null)); stationOverlaysRef.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations, mapReady]);
  useEffect(() => {
    drawLayer(schoolOverlaysRef, schools, (s) => layerHtml('🏫', s.kind ? `${s.name} (${s.kind})` : s.name, '#2E9E5B'), 4);
    return () => { schoolOverlaysRef.current.forEach((o) => o.setMap(null)); schoolOverlaysRef.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schools, mapReady]);

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

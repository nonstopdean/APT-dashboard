'use client';

import { useEffect, useRef, useState } from 'react';
import { geocodeCache, runPool, fetchServerGeocodeCache, queueServerGeocodeSave, serverGeocodeStats } from '../lib/geocodeCache';
import { placeContextOf, pickPlace, resolveMarkerCoord, summarizeCoordSources, jibunAddressOf } from '../lib/geocode-pick';

// features: [{ feature, name, code }] - 안정적으로 유지되는 배열. values: features와 같은 순서의
// [number|null] 배열로 색상만 자주 바뀔 수 있다. 클릭할 때마다 도형을 다시 그리지 않기 위해 나눴다.
const EMPTY_KEY_SET = new Set();

// 마커 모양. 비교함에 담은 단지(pinned)는 ★ + 강조 테두리로 구분한다.
function markerHtmlOf(titleText, priceText, pinned) {
  const border = pinned ? '2px solid #1D4ED8' : '1px solid rgba(40,35,30,0.18)';
  const bg = pinned ? '#EAF1FF' : 'rgba(255,255,255,0.96)';
  const star = pinned ? '<span style="margin-right:3px;color:#1D4ED8;">★</span>' : '';
  // v236: 아래 빨간 점의 가운데가 단지 좌표에 오게(가로 가운데·세로 아래) 옮긴다 — 겹침 계산(pinLabelBox)과 작은 점 마커가 같은 자리를 쓴다.
  // 예전(앵커 0,24)엔 이름표 왼쪽 끝이 좌표라 점이 이름표 폭의 절반만큼 오른쪽에 찍혔다.
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:auto;cursor:pointer;transform:translate(-50%,calc(-100% + 6px));">` +
    `<div style="padding:4px 7px;border-radius:8px;background:${bg};border:${border};box-shadow:0 2px 8px rgba(0,0,0,0.16);font-size:10px;line-height:1.1;white-space:nowrap;color:#2b2722;font-weight:700;">${star}${titleText}${priceText ? `<span style="margin-left:5px;color:#1D4ED8;">${priceText}</span>` : ''}</div>` +
    `<div style="width:7px;height:7px;border-radius:50%;background:#1D4ED8;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.22);"></div></div>`;
}

// v236: 이름표 자리가 없을 때 남기는 작은 점(누르면 그 단지가 바로 열림, 마우스를 올리면 이름). 앵커 (6.5, 6.5) = 점 가운데.
function dotHtmlOf(titleText, count) {
  const tip = count > 1 ? `${titleText} 외 ${count - 1}곳` : titleText;
  return `<div title="${tip}" style="box-sizing:border-box;width:13px;height:13px;border-radius:50%;background:#1D4ED8;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:pointer;"></div>`;
}

// v236: 이름표가 화면에서 차지하는 상자(px, 좌표 기준). markerHtmlOf 글자 크기 10px 기준 어림값 — 한글 10.5px, 그 밖 6.2px.
export function pinLabelBox(x, y, titleText, priceText) {
  // 실제 그린 크기와 대조(v236): 헬리오시티 23억 실제 폭 88px·높이 −27~+6 → 어림 96px(양옆 4px 여유)·−29~+6.
  let w = 14 + (priceText ? 5 : 0);
  for (const ch of `${titleText}${priceText || ''}`) w += ch.codePointAt(0) > 0x2000 ? 10.5 : ch === ' ' ? 3 : 6.2;
  return { x1: x - w / 2 - 2, x2: x + w / 2 + 2, y1: y - 29, y2: y + 6 };
}

// v236: 겹치지 않게 이름표 자리 정하기(순수 함수). items: [{ x, y, title, price, force }] — 이미 중요도 순으로 정렬.
// force(비교함 ★)는 겹쳐도 항상 이름표. 돌려주는 값: 이름표를 붙일 항목 번호 Set.
export function placePinLabels(items) {
  const placed = [];
  const chosen = new Set();
  items.forEach((it, i) => {
    const r = pinLabelBox(it.x, it.y, it.title, it.price);
    const hit = placed.some((p) => r.x1 < p.x2 && r.x2 > p.x1 && r.y1 < p.y2 && r.y2 > p.y1);
    if (hit && !it.force) return;
    placed.push(r);
    chosen.add(i);
  });
  return chosen;
}

// 핀에 적는 가격(v196). mode: 'deal'(평형 상관없이 가장 최근 거래) | 'p34'(34평 안팎 최근 거래) | 'unit'(최근 거래 평당가)
function fmtPinPrice(v) {
  if (!Number.isFinite(v)) return '';
  return v >= 10000 ? `${(v / 10000).toFixed(1).replace(/\.0$/, '')}억` : `${Math.round(v).toLocaleString()}만`;
}
// 핀 이름(v227): 동별 대장 아파트(c.leader)는 앞에 👑. HTML에 들어가므로 특수문자는 뺀다.
function pinTitleOf(c) {
  return `${c.leader ? '👑 ' : ''}${String(c.apt || '').replace(/[<>&"']/g, '')}`;
}
function pinPriceTextOf(c, mode) {
  if (mode === 'unit') return Number.isFinite(c.latestPyeong) ? `${Math.round(c.latestPyeong).toLocaleString()}만/평` : '';
  if (mode === 'p34') return fmtPinPrice(c.latest34Price);
  return fmtPinPrice(c.latestPrice);
}

export default function NaverChoropleth({
  features, values, colorFor, borderColor, onSelect, height, focusLatLng, complexes, onComplexSelect,
  dongFeatures, dongValues, onZoomTierChange, onViewportChange, onVisibleMarkerCount, onGeocodeStats, onClusterOpen, pinnedKeys, valueFormat, valueNotes, dongValueNotes, stations, schools,
  pinPriceMode = 'deal', areaBubbles = null,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const polygonsRef = useRef([]); // [{ polygon, featureIndex }] - 구 단위
  const dongPolygonsRef = useRef([]); // [{ polygon, featureIndex }] - 동 단위
  const markersRef = useRef([]); // [{ marker, key }]
  const stationMarkersRef = useRef([]);
  const schoolMarkersRef = useRef([]);
  const clustererRef = useRef([]); // [{ overlay }] — v236부터는 같은 자리 단지 묶음 이름표·점
  const dotMarkersRef = useRef(new Map()); // v236: 단지 key → 작은 점 마커(다시 쓰기)
  const clusterSignatureRef = useRef('');
  const refineRunningRef = useRef(false); // 동 중심점 마커의 위치 다듬기가 진행 중인지
  const refineAttemptsRef = useRef(0); // 이번 접속에서 다듬기를 시도한 단지 수(과도한 호출 방지)
  // 위치 다듬기 진단 카운터: 화면 카드에 보여서 "어디서 막혔는지"를 바로 알 수 있게 한다.
  //   kakao: 카카오 검색 호출 결과 종류별 횟수 / refine: 단지 단위 결과
  const diagRef = useRef({
    kakao: { calls: 0, picked: 0, zero: 0, rejected: 0, error: 0, lastError: '', addr: 0 }, // addr: 지번 주소 검색으로 찾은 수(v228)
    refine: { attempted: 0, moved: 0, far: 0, sdkFail: 0 },
  });
  const onClusterOpenRef = useRef(onClusterOpen);
  const pinnedKeysRef = useRef(pinnedKeys || EMPTY_KEY_SET); // 비교함에 담은 단지 키 — 지도에서 ★로 강조하고 클러스터에 묻히지 않게 한다
  const pinPriceModeRef = useRef(pinPriceMode);
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
  const kakaoGeocoderRef = useRef(null);
  // v228: 숫자 묶음을 누르면 그 자리에 단지 목록 팝업을 띄운다 — 확대하지 않아도 바로 고를 수 있게.
  const [clusterPop, setClusterPop] = useState(null);
  const popOpenedAtRef = useRef(0);

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
        m.marker.setIcon({ content: markerHtmlOf(m.title, m.priceText, isPinned), anchor: new window.naver.maps.Point(0, 0) });
      }
      if (typeof m.marker.setZIndex === 'function') m.marker.setZIndex(isPinned ? 40 : 20);
    });
    clusterSignatureRef.current = '';
    syncNaverClusterer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedKeys]);
  // 이미 만들어진 마커의 가격 글자만 다시 맞춘다(v196) — 핀 가격 기준을 바꿨거나, 기간을 바꿔 같은 단지의 최근 거래가 달라졌을 때.
  // 마커를 새로 만들지 않고 글자가 달라진 것만 setIcon 한다.
  const refreshMarkerTexts = (list) => {
    if (!window.naver?.maps) return;
    const byKey = new Map((list || complexesRef.current || []).map((c) => [c.key, c]));
    markersRef.current.forEach((m) => {
      const c = byKey.get(m.key);
      if (!c) return;
      const priceText = pinPriceTextOf(c, pinPriceModeRef.current);
      const title = pinTitleOf(c); // v227: 기간이 바뀌면 대장(👑)도 바뀔 수 있다
      if (priceText === m.priceText && title === m.title) return;
      m.priceText = priceText;
      m.title = title;
      if (typeof m.marker.setIcon === 'function') {
        m.marker.setIcon({ content: markerHtmlOf(title, priceText, m.pinned), anchor: new window.naver.maps.Point(0, 0) });
      }
    });
  };
  useEffect(() => {
    pinPriceModeRef.current = pinPriceMode;
    refreshMarkerTexts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinPriceMode]);
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
  const reportViewportRef = useRef(null);
  reportViewportRef.current = reportViewport;
  const focusLatLngRef = useRef(focusLatLng); // v233: 지도를 만들 때 쓰는 최신 첫 위치
  focusLatLngRef.current = focusLatLng;

  // 네이버 zoom: 숫자가 클수록 확대된 상태. far는 12 이하(구 색칠), mid는 13(동 색칠), near는 14 이상(단지 핀·묶음).
  // v232: 아실처럼 단계별 말풍선 — 9 이하 시·도, 10~12 시·군·구, 13 동(말풍선), 14 이상 단지 핀. (v228~v231은 13부터 핀이었다.)
  const FAR_ZOOM_LEVEL = 12;
  const NEAR_ZOOM_LEVEL = 14;
  const zoomTierRef = useRef('far'); // 'far' | 'mid' | 'near'
  // zoom_changed 리스너는 지도를 만들 때 한 번만 붙는다. 함수를 직접 넘기면 첫 렌더(단지 목록이 비어 있던 때)의
  // 함수가 계속 불려서, 확대 직후 "그릴 단지 없음"으로 끝나며 idle이 예약한 최신 마커 갱신까지 취소했다
  // (v168까지: 확대만 하면 핀이 안 나오고 지도를 한 번 끌어야 나왔다). 그래서 매 렌더 최신 함수를 ref로 부른다.
  const zoomChangedRef = useRef(null);

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

  // v228: 지번 주소로 좌표 찾기(카카오 주소 검색). 시·도/시군구가 맞는 결과만 쓴다(pickPlace가 address_name으로 확인).
  const geocodeAddress = (address, ctx) => new Promise((resolve) => {
    if (!address || !window.kakao?.maps?.services?.Geocoder) return resolve(null);
    if (!kakaoGeocoderRef.current) kakaoGeocoderRef.current = new window.kakao.maps.services.Geocoder();
    const kd = diagRef.current.kakao;
    kd.calls += 1;
    kakaoGeocoderRef.current.addressSearch(address, (result, status) => {
      if (status === window.kakao.maps.services.Status.OK && result?.length) {
        const picked = pickPlace(result, ctx);
        if (picked) { kd.picked += 1; kd.addr += 1; } else kd.rejected += 1;
        resolve(picked);
      } else if (status === 'ZERO_RESULT' || status === window.kakao.maps.services.Status.OK) {
        kd.zero += 1;
        resolve(null);
      } else {
        kd.error += 1; kd.lastError = String(status);
        resolve(null);
      }
    });
  });

  // 단지 하나의 정확한 위치: 지번 주소 검색을 먼저, 안 되면 예전처럼 이름 검색(지역·동 + 이름 → 동 + 이름 → 이름).
  const locateComplex = async (c) => {
    const ctx = { place: placeContextOf(c.regionCode), dong: c.dong, aptName: c.apt };
    const addr = jibunAddressOf(c.regionCode, c.dong, c.jibun);
    return (addr && await geocodeAddress(addr, ctx))
      || await geocodeComplex(`${c.regionName} ${c.dong} ${c.apt}`, ctx)
      || await geocodeComplex(`${c.dong} ${c.apt}`, ctx)
      || await geocodeComplex(c.apt, ctx);
  };

  // 지금 단지들의 좌표가 어디서 왔는지(정확/동 중심/못 찾음/대기)를 세서 화면 카드로 알려준다.
  // 값이 바뀔 때만 부모에 알린다.
  const reportGeocodeStats = () => {
    const cb = onGeocodeStatsRef.current;
    if (!cb || !complexesRef.current?.length) return;
    const stats = summarizeCoordSources(complexesRef.current, geocodeCache);
    const d = diagRef.current;
    const sig = `${stats.total}|${stats.exact}|${stats.approx}|${stats.failed}|${stats.pending}|${d.kakao.calls}|${d.kakao.picked}|${d.kakao.zero}|${d.kakao.rejected}|${d.kakao.error}|${d.kakao.addr}|${d.refine.attempted}|${d.refine.moved}|${d.refine.far}|${d.refine.sdkFail}|${serverGeocodeStats.calls}|${serverGeocodeStats.asked}|${serverGeocodeStats.hit}`;
    if (sig === lastGeocodeStatsRef.current) return;
    lastGeocodeStatsRef.current = sig;
    cb({ ...stats, kakao: { ...d.kakao }, refine: { ...d.refine }, server: { ...serverGeocodeStats } });
  };

  // 마커는 일단 동 중심점에 띄워 화면을 빨리 보여주고, 정확한 위치를 찾는 대로 옮긴다.
  // 같은 동 단지가 전부 한 점에 겹치면 클러스터러가 어떤 줌에서도 숫자 원 하나로만 묶어서, 확대해도 안 풀렸다.
  //  - 한 번에 REFINE_BATCH개, 동시에 5개씩(v228: 지번 주소 검색이 가벼워서 3→5), 화면 중심에서 가까운 순서로 처리한다.
  //  - 지도를 움직여도 중단하지 않고, 남은 단지는 이어서 처리한다(이전 단계의 seq 중단과 별개).
  //  - 옮긴 뒤에는 클러스터러 서명을 지워 다시 그리게 한다(위치만 바뀌면 서명이 같아 화면이 안 바뀐다).
  //  - 못 찾으면 geocodeCache에 null을 남겨 이번 접속에서는 다시 시도하지 않는다(동 중심점에 그대로 둔다).
  const REFINE_BATCH = 40;
  const REFINE_SESSION_CAP = 3000;
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
          const coord = await locateComplex(c);
          geocodeCache[c.key] = coord; // null이면 못 찾음 — 이번 접속에서는 재시도하지 않는다
          if (!coord) return;
          const { coord: picked, source } = resolveMarkerCoord({ lat: c.lat, lng: c.lng }, coord);
          if (source !== 'exact') { diagRef.current.refine.far += 1; return; } // 동 중심에서 너무 먼 값은 버린다
          const entry = markersRef.current.find((m) => m.key === c.key);
          if (!entry || typeof entry.marker.setPosition !== 'function') return;
          entry.marker.setPosition(new window.naver.maps.LatLng(picked.lat, picked.lng));
          found.push({ key: c.key, lat: picked.lat, lng: picked.lng });
          diagRef.current.refine.moved += 1;
        }, 5);
        if (found.length) {
          queueServerGeocodeSave(found);
          clusterSignatureRef.current = ''; // 위치가 바뀌었으니 클러스터를 다시 만든다
          syncNaverClusterer();
        }
        reportGeocodeStats();
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 150)); // 호출이 몰리지 않게 잠깐 쉰다
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
  // v232: 단계별 말풍선 — 줌에 맞는 단계(시·도/시·군·구/동)의 말풍선만 지도에 붙인다. 단계나 자료가 바뀔 때만 다시 만든다.
  // 누르면 그 자리로 다음 단계까지 확대한다(시·도 → 11, 시·군·구 → 13, 동 → 14 단지 핀).
  const bubbleLevelOf = (z) => (z <= 9 ? 'sido' : z <= 12 ? 'sgg' : z === 13 ? 'dong' : null);
  const BUBBLE_NEXT_ZOOM = { sido: 11, sgg: 13, dong: 14 };
  const fmtBubbleValue = (b) => {
    if (b.kind === 'pyeong') return `평당 ${Math.round(b.value).toLocaleString()}만`;
    return b.value >= 10000 ? `${(b.value / 10000).toFixed(1)}억` : `${Math.round(b.value).toLocaleString()}만`;
  };
  const bubbleHtml = (b, level) => {
    const bg = level === 'dong' ? '#0F1E3D' : '#2563EB';
    const esc = (s) => String(s).replace(/[<>&"']/g, '');
    const ch = Number.isFinite(b.change) && Math.abs(b.change) >= 0.05
      ? `<div style="font-size:9.5px;font-weight:600;opacity:.92">${b.change > 0 ? '▲' : '▼'}${Math.abs(b.change).toFixed(1)}%</div>` : '';
    return `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;cursor:pointer;pointer-events:auto;">`
      + `<div style="background:${bg};color:#fff;border-radius:10px;padding:4px 9px 5px;text-align:center;line-height:1.25;box-shadow:0 2px 8px rgba(0,0,0,0.25);white-space:nowrap;">`
      + `<div style="font-size:10.5px;font-weight:600;opacity:.9">${esc(b.name)}</div>`
      + `<div style="font-size:${level === 'sido' ? 14 : 12.5}px;font-weight:800">${fmtBubbleValue(b)}</div>${ch}</div>`
      + `<div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:7px solid ${bg};"></div></div>`;
  };
  const bubbleMarkersRef = useRef([]);
  const bubbleSigRef = useRef('');
  const areaBubblesRef = useRef(areaBubbles);
  const syncBubbles = () => {
    const map = mapRef.current;
    if (!map || !window.naver?.maps) return;
    const level = bubbleLevelOf(map.getZoom());
    const data = level ? (areaBubblesRef.current?.[level] || []) : [];
    const sig = `${level}|${data.length}|${data.map((b) => `${b.key}:${b.value}`).join(',')}`;
    if (sig === bubbleSigRef.current) return;
    bubbleSigRef.current = sig;
    bubbleMarkersRef.current.forEach((m) => m.setMap(null));
    bubbleMarkersRef.current = [];
    data.slice(0, 400).forEach((b) => {
      const marker = new window.naver.maps.Marker({
        position: new window.naver.maps.LatLng(b.lat, b.lng),
        map,
        icon: { content: bubbleHtml(b, level), anchor: new window.naver.maps.Point(0, 0) },
        zIndex: 30,
      });
      window.naver.maps.Event.addListener(marker, 'click', () => {
        map.morph(new window.naver.maps.LatLng(b.lat, b.lng), BUBBLE_NEXT_ZOOM[level]);
      });
      bubbleMarkersRef.current.push(marker);
    });
  };
  useEffect(() => {
    areaBubblesRef.current = areaBubbles;
    syncBubbles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaBubbles]);
  useEffect(() => () => { bubbleMarkersRef.current.forEach((m) => m.setMap(null)); bubbleMarkersRef.current = []; }, []);

  // v228: 묶음을 누르면 그 자리에 단지 목록 팝업. 화면 위치는 지도 범위 비율로 계산한다(작은 범위라 직선 근사로 충분).
  const openClusterPopup = (keys, lat, lng, canSeparate) => {
    const map = mapRef.current;
    const el = containerRef.current;
    if (!map || !el) return;
    const b = map.getBounds();
    if (!b) return;
    const sw = b.getSW(); const ne = b.getNE();
    const W = el.clientWidth; const H = el.clientHeight;
    const x = ((lng - sw.lng()) / (ne.lng() - sw.lng())) * W;
    const y = ((ne.lat() - lat) / (ne.lat() - sw.lat())) * H;
    const byKey = new Map((complexesRef.current || []).map((c) => [c.key, c]));
    const posByKey = new Map(markersRef.current.map((m) => [m.key, m.marker.getPosition()]));
    const items = keys.map((k) => {
      const c = byKey.get(k);
      if (!c) return null;
      const p = posByKey.get(k);
      return { ...c, lat: p ? p.lat() : c.lat, lng: p ? p.lng() : c.lng };
    }).filter(Boolean).sort((a, b2) => ((b2.leader ? 1 : 0) - (a.leader ? 1 : 0)) || ((b2.latestPrice ?? -1) - (a.latestPrice ?? -1)));
    popOpenedAtRef.current = Date.now();
    setClusterPop({ x, y, W, H, keys, items, lat, lng, canSeparate });
  };

  // v236: 숫자 원(격자 묶음)을 없애고 호갱노노·아실처럼 단지 이름표를 그대로 보여준다(v235까지 송파 줌 15에서 화면 속 135곳 중
  // 16곳만 이름표, 나머지는 숫자 원 속에 숨어 있었다). 이름표끼리 겹치면 중요한 단지(★ 비교함 → 👑 대장 → 가격 있는 단지 → 비싼 순)가
  // 자리를 차지하고, 자리를 못 잡은 단지는 작은 빨간 점으로 남긴다(점을 눌러도 그 단지가 바로 열린다). 확대할수록 이름표가 늘어난다.
  // 같은 자리(약 1m 이내, 같은 지번의 1·2단지 등)에 여러 단지가 있으면 이름표 하나에 "외 N"을 붙이고, 누르면 그 단지들 목록 팝업.
  const syncNaverClusterer = () => {
    const map = mapRef.current;
    if (!map || !window.naver?.maps) return;
    const N = window.naver.maps;
    const clearGroupOverlays = () => {
      clustererRef.current.forEach(({ overlay }) => overlay.setMap(null));
      clustererRef.current = [];
    };
    const show = map.getZoom() >= NEAR_ZOOM_LEVEL;
    if (!show) {
      clearGroupOverlays();
      clusterSignatureRef.current = '';
      markersRef.current.forEach(({ marker }) => marker.setMap(null));
      dotMarkersRef.current.forEach((d) => d.setMap(null));
      onVisibleMarkerCountRef.current?.(0);
      return;
    }
    const zoom = map.getZoom();
    const vb = map.getBounds();
    const vsize = map.getSize();
    if (!vb || !vsize?.width || !vsize?.height) return;
    const markerSig = markersRef.current.map(({ key, priceText, title }) => `${key}:${title}:${priceText}`).sort().join(',');
    const signature = `${zoom}|${markerSig}`;
    // 같은 줌·같은 마커(이름·가격 포함)면 자리 배치가 같으므로 그대로 둔다(이동만 하면 상대 위치가 안 바뀐다).
    if (signature === clusterSignatureRef.current) return;
    clearGroupOverlays();
    clusterSignatureRef.current = signature;

    // 화면 px 좌표(메르카토르). 줌이 같으면 지도를 옮겨도 단지끼리의 상대 위치는 같다.
    const sw = vb.getSW(); const ne = vb.getNE();
    const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const pxPerLng = vsize.width / Math.max(1e-9, ne.lng() - sw.lng());
    const pxPerY = vsize.height / Math.max(1e-12, mercY(ne.lat()) - mercY(sw.lat()));
    const topY = mercY(ne.lat());
    const toPx = (lat, lng) => ({ x: (lng - sw.lng()) * pxPerLng, y: (topY - mercY(lat)) * pxPerY });

    const complexByKey = new Map((complexesRef.current || []).map((c) => [c.key, c]));
    const pinnedSet = pinnedKeysRef.current;
    const rank = (m) => (pinnedSet.has(m.key) ? 8 : 0) + (complexByKey.get(m.key)?.leader ? 4 : 0) + (m.priceText ? 2 : 0);
    const priceOf = (m) => complexByKey.get(m.key)?.latestPrice ?? 0;
    const cmp = (a, b) => rank(b) - rank(a) || priceOf(b) - priceOf(a) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

    const groupMap = new Map();
    markersRef.current.forEach((m) => {
      const pos = m.marker.getPosition();
      const gk = `${pos.lat().toFixed(5)}|${pos.lng().toFixed(5)}`;
      if (!groupMap.has(gk)) groupMap.set(gk, { lat: pos.lat(), lng: pos.lng(), items: [] });
      groupMap.get(gk).items.push(m);
    });
    const groups = [...groupMap.values()];
    groups.forEach((g) => { g.items.sort(cmp); g.lead = g.items[0]; g.extra = g.items.length > 1 ? ` 외 ${g.items.length - 1}` : ''; });
    groups.sort((a, b) => cmp(a.lead, b.lead));
    const chosen = placePinLabels(groups.map((g) => {
      const { x, y } = toPx(g.lat, g.lng);
      return { x, y, title: g.lead.title + g.extra, price: g.lead.priceText, force: g.items.some((m) => pinnedSet.has(m.key)) };
    }));

    const attach = (mk, on) => { const want = on ? map : null; if (mk.getMap() !== want) mk.setMap(want); };
    const shownDots = new Set();
    const selectByKey = (key) => {
      const c = (complexesRef.current || []).find((x) => x.key === key);
      const m = markersRef.current.find((x) => x.key === key);
      const p = m?.marker.getPosition();
      if (c) onComplexSelectRef.current?.({ ...c, lat: p ? p.lat() : c.lat, lng: p ? p.lng() : c.lng });
    };
    groups.forEach((g, i) => {
      const labeled = chosen.has(i);
      const single = g.items.length === 1;
      g.items.forEach((m) => attach(m.marker, labeled && single));
      if (labeled && single) return;
      const keys = g.items.map((m) => m.key);
      if (labeled) {
        // 같은 자리 여러 단지: 대표 단지 이름표 + "외 N" → 누르면 목록 팝업.
        const isPinned = g.items.some((m) => pinnedSet.has(m.key));
        const overlay = new N.Marker({
          position: new N.LatLng(g.lat, g.lng),
          icon: { content: markerHtmlOf(g.lead.title + g.extra, g.lead.priceText, isPinned), anchor: new N.Point(0, 0) },
          zIndex: isPinned ? 40 : 30,
        });
        overlay.setMap(map);
        N.Event.addListener(overlay, 'click', () => openClusterPopup(keys, g.lat, g.lng, false));
        clustererRef.current.push({ overlay });
        return;
      }
      if (single) {
        // 자리 없는 단지 하나: 작은 점(다시 쓰기). 누르면 그 단지 상세.
        const key = g.lead.key;
        let dot = dotMarkersRef.current.get(key);
        if (!dot) {
          dot = new N.Marker({
            position: new N.LatLng(g.lat, g.lng),
            icon: { content: dotHtmlOf(g.lead.title, 1), anchor: new N.Point(6.5, 6.5) },
            zIndex: 10,
          });
          N.Event.addListener(dot, 'click', () => selectByKey(key));
          dotMarkersRef.current.set(key, dot);
        } else {
          const p = dot.getPosition();
          if (p.lat() !== g.lat || p.lng() !== g.lng) dot.setPosition(new N.LatLng(g.lat, g.lng));
        }
        attach(dot, true);
        shownDots.add(key);
        return;
      }
      // 자리 없는 같은 자리 묶음: 점 하나 → 누르면 목록 팝업.
      const overlay = new N.Marker({
        position: new N.LatLng(g.lat, g.lng),
        icon: { content: dotHtmlOf(g.lead.title, g.items.length), anchor: new N.Point(6.5, 6.5) },
        zIndex: 10,
      });
      overlay.setMap(map);
      N.Event.addListener(overlay, 'click', () => openClusterPopup(keys, g.lat, g.lng, false));
      clustererRef.current.push({ overlay });
    });
    dotMarkersRef.current.forEach((dot, key) => { if (!shownDots.has(key)) attach(dot, false); });
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
      reportViewport(); // v230: 단계가 바뀌면 범위도 같이 알린다(주변 구 자동 불러오기가 바로 시작되게)
    }
    scheduleMarkerSync(120);
    schedulePolygonViewportSync(80);
    syncBubbles(); // v232: 줌마다 말풍선 단계를 맞춘다
  };

  const handleZoomChanged = () => {
    setClusterPop(null); // 확대·축소하면 묶음이 바뀌므로 팝업을 닫는다
    if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
    zoomDebounceRef.current = setTimeout(handleZoomChangedImmediate, 150);
  };
  zoomChangedRef.current = handleZoomChanged;

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_NAVER_MAP_KEY_ID;
    if (!key) return undefined;

    let cancelled = false;

    function draw() {
      if (cancelled || !containerRef.current || !window.naver?.maps) return;

      if (!mapRef.current) {
        // 다른 탭(순위표 등)에서 지역을 눌러 넘어오면 focusLatLng가 이미 정해져 있다 — 그곳에서 시작한다(v188).
        // v233: 이 함수는 경계 자료가 생긴 때의 렌더에서 만들어져 그때의 focusLatLng(대개 null)를 기억한다. 지도 스크립트가 늦게
        // 받아지면 그 사이 정해진 첫 화면 위치(기억한 지역, 줌 13)를 놓치고 서울 줌 11로 만들어졌다 → 늘 최신 값(ref)을 쓴다.
        const fl = focusLatLngRef.current;
        mapRef.current = new window.naver.maps.Map(containerRef.current, {
          center: new window.naver.maps.LatLng(fl?.lat ?? 37.5665, fl?.lng ?? 126.978),
          zoom: fl ? (fl.zoom || 13) : 11,
        });
        window.naver.maps.Event.addListener(mapRef.current, 'zoom_changed', () => zoomChangedRef.current?.());
        // v230: 처음부터 줌 13 이상으로 만들면 zoom_changed가 안 와서 단계가 'far'로 남았다(핀·주변 구 불러오기가 안 됨) — 한 번 맞춘다.
        zoomChangedRef.current?.();
        // v230: 화면 범위 알림은 지도를 만들 때 바로 붙인다. 아래 idle effect는 단지 목록이 바뀔 때만 붙어서, 지역을 고르지 않은
        // 첫 화면(단지 0개)에서는 범위가 안 알려져 주변 구 자동 불러오기가 시작되지 않았다.
        window.naver.maps.Event.addListener(mapRef.current, 'idle', () => reportViewportRef.current?.());
        // 첫 idle이 오지 않는 경우가 있어(실제 사이트에서 끌기 전까지 범위가 안 알려짐) 만든 직후에도 한 번 알린다.
        setTimeout(() => reportViewportRef.current?.(), 700);
        // v228: 지도를 끌거나 빈 곳을 누르면 묶음 팝업을 닫는다(묶음을 누른 직후 따라오는 지도 클릭은 무시).
        window.naver.maps.Event.addListener(mapRef.current, 'dragstart', () => setClusterPop(null));
        window.naver.maps.Event.addListener(mapRef.current, 'click', () => {
          if (Date.now() - popOpenedAtRef.current > 400) setClusterPop(null);
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
        // v232: 구 영역을 눌러 그 지역을 조회하던 동작은 없앴다(사용자 요청 — 단계별 말풍선을 눌러 확대한다).
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
      dotMarkersRef.current.forEach((d) => d.setMap(null));
      dotMarkersRef.current = new Map();
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
        // v232: 동 영역 클릭으로 지역을 조회하던 동작도 없앴다.
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
    // v229: 단지 검색으로 오면 zoom 16(단지가 보이게), 그 밖에는 구가 보이는 13.
    // v232: 첫 화면 이동(instant)은 애니메이션 없이 바로 — morph 도중 창 크기가 바뀌면 중간 줌에서 멈출 수 있었다.
    const target = new window.naver.maps.LatLng(focusLatLng.lat, focusLatLng.lng);
    if (focusLatLng.instant) {
      mapRef.current.setCenter(target);
      mapRef.current.setZoom(focusLatLng.zoom || 13, false);
    } else {
      mapRef.current.morph(target, focusLatLng.zoom || 13);
    }
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
    // v238: 화면 안인지는 "실제 핀이 찍힐 좌표"(정확한 좌표가 있으면 그것, 없으면 동 중심점)로 판단한다. 예전엔 동 중심점(c.lat)만 봐서,
    // 많이 확대해 동 중심점이 화면 밖으로 나가면 그 동 단지 핀이 통째로 사라졌다(송파 줌 17 → 5개, 18 → 2개, 19 → 0개).
    // 정확한 좌표를 아직 모르는 단지는 동 중심점이 화면 주변(약 3km) 안이면 서버 저장 좌표를 먼저 물어본다.
    const approxOf = (c) => (c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : null);
    const posOf = (c) => resolveMarkerCoord(approxOf(c), geocodeCache[c.key]).coord || approxOf(c);
    {
      const b0 = mapRef.current.getBounds();
      const PAD = 0.03; // 위도·경도 약 3km
      const nearUnknown = b0 ? complexes.filter((c) => geocodeCache[c.key] === undefined && c.lat != null
        && c.lat > b0.getSW().lat() - PAD && c.lat < b0.getNE().lat() + PAD && c.lng > b0.getSW().lng() - PAD && c.lng < b0.getNE().lng() + PAD).map((c) => c.key) : [];
      if (nearUnknown.length) { // fetchServerGeocodeCache가 이미 물어본 key는 알아서 빼므로 같은 단지를 반복해 묻지 않는다
        const hits = await fetchServerGeocodeCache(nearUnknown.slice(0, 600));
        if (seq !== markerSyncSeqRef.current) return;
        Object.entries(hits).forEach(([key, coord]) => { geocodeCache[key] = coord; });
      }
    }
    const visibleComplexes = complexes.filter((c) => {
      const p = posOf(c);
      if (!p) return true;
      return isInBounds(p, bounds);
    });
    // 확대도가 높을수록 화면에 실제로 보이는 단지를 더 많이 표시한다.
    const zoom = mapRef.current.getZoom();
    // v228: 250개 → 400개부터(줌 13에서 구 하나가 다 보이므로). 확대할수록 조금씩 더(최대 700).
    const maxMarkers = Math.min(700, Math.max(400, 400 + Math.round((zoom - NEAR_ZOOM_LEVEL) * 100)));
    const distOf = (c) => { const p = posOf(c); return p ? (p.lat - centerLat) ** 2 + (p.lng - centerLng) ** 2 : Number.POSITIVE_INFINITY; };
    visibleComplexes.sort((a, b) => distOf(a) - distOf(b));
    const candidate = visibleComplexes.slice(0, maxMarkers);
    const existingKeys = new Set(markersRef.current.map((m) => m.key));
    const wanted = new Set(candidate.map((c) => c.key));

    markersRef.current = markersRef.current.filter((m) => {
      if (wanted.has(m.key)) return true;
      m.marker.setMap(null);
      return false;
    });
    refreshMarkerTexts(candidate);
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
        coord = await locateComplex(c);
        geocodeCache[c.key] = coord;
        if (coord) newlyFound.push({ key: c.key, lat: coord.lat, lng: coord.lng });
      }
      if (seq !== markerSyncSeqRef.current || !coord) return;
      const priceText = pinPriceTextOf(c, pinPriceModeRef.current);
      const titleText = pinTitleOf(c);
      const pinned = pinnedKeysRef.current.has(c.key);
      const markerHtml = markerHtmlOf(titleText, priceText, pinned);
      const marker = new window.naver.maps.Marker({
        position: new window.naver.maps.LatLng(coord.lat, coord.lng),
        icon: {
          content: markerHtml,
          anchor: new window.naver.maps.Point(0, 0),
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
    setClusterPop(null); // 단지 목록이 바뀌면(지역·기간·필터) 열려 있던 묶음 팝업은 맞지 않는다
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
      // 화면 범위 알림은 지도를 만들 때 붙인 idle 리스너가 한다(v230).
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

  // v228: 묶음 팝업 — 묶음 바로 위(화면 아래쪽이면) 또는 아래(위쪽이면)에 띄우고, 지도 밖으로 나가지 않게 좌우를 맞춘다.
  let popupEl = null;
  if (clusterPop) {
    const PW = Math.min(260, Math.max(180, clusterPop.W - 16));
    const left = Math.max(8, Math.min(clusterPop.x - PW / 2, clusterPop.W - PW - 8));
    const below = clusterPop.y < clusterPop.H / 2;
    const vpos = below ? { top: Math.max(8, clusterPop.y + 30) } : { bottom: Math.max(8, clusterPop.H - clusterPop.y + 30) };
    const maxH = Math.max(140, Math.min(300, below ? clusterPop.H - clusterPop.y - 46 : clusterPop.y - 46));
    popupEl = (
      <div
        style={{
          position: 'absolute', left, ...vpos, width: PW, zIndex: 30, background: '#fff', borderRadius: 10,
          boxShadow: '0 6px 20px rgba(0,0,0,0.22)', border: '1px solid rgba(40,35,30,0.14)', fontSize: 12, color: '#2b2722',
          display: 'flex', flexDirection: 'column', maxHeight: maxH,
        }}
        onWheel={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '1px solid #eee' }}>
          <b style={{ flex: 1 }}>이 근처 단지 {clusterPop.items.length}곳</b>
          <span style={{ cursor: 'pointer', color: '#9C9B96', fontSize: 14, lineHeight: 1 }} onClick={() => setClusterPop(null)} title="닫기">✕</span>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {clusterPop.items.map((c) => {
            const price = pinPriceTextOf(c, pinPriceModeRef.current);
            return (
              <div
                key={c.key}
                onClick={() => { setClusterPop(null); onComplexSelectRef.current?.(c); }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', cursor: 'pointer', borderBottom: '1px solid #f3f3f1' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f7f5f2'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pinnedKeysRef.current.has(c.key) ? '★ ' : ''}{c.leader ? '👑 ' : ''}{c.apt}
                  </div>
                  <div style={{ fontSize: 10.5, color: '#9C9B96' }}>{c.dong}{c.latestPrice == null ? ' · 이 기간 거래 없음' : ''}</div>
                </div>
                {price && <span style={{ color: '#1D4ED8', fontWeight: 700, whiteSpace: 'nowrap' }}>{price}</span>}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 6, padding: '7px 10px', borderTop: '1px solid #eee' }}>
          {clusterPop.canSeparate && (
            <button
              type="button"
              onClick={() => {
                const map = mapRef.current;
                setClusterPop(null);
                if (map && window.naver?.maps) map.morph(new window.naver.maps.LatLng(clusterPop.lat, clusterPop.lng), Math.min(map.getZoom() + 2, 19));
              }}
              style={{ flex: 1, padding: '5px 0', fontSize: 11.5, borderRadius: 6, border: '1px solid #D2D0CA', background: '#fff', cursor: 'pointer' }}
            >
              🔍 확대해서 보기
            </button>
          )}
          {onClusterOpenRef.current && (
            <button
              type="button"
              onClick={() => { const keys = clusterPop.keys; setClusterPop(null); onClusterOpenRef.current?.(keys); }}
              style={{ flex: 1, padding: '5px 0', fontSize: 11.5, borderRadius: 6, border: '1px solid #D2D0CA', background: '#fff', cursor: 'pointer' }}
            >
              📋 목록에서 보기
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', flex: 1, minHeight: 0, borderRadius: 8, overflow: 'hidden', touchAction: 'none' }} />
      {popupEl}
    </div>
  );
}

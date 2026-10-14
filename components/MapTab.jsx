import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import NaverChoropleth from './NaverChoropleth';
import KakaoChoropleth from './KakaoChoropleth';
import PinnedCompareDrawer from './PinnedCompareDrawer';
import RecentTradesFeed from './RecentTradesFeed';
import { classifyListOnly } from '../lib/complex-match';
import { regionLabel } from '../lib/regions';
import { PALETTE, fmtWon, fmtArea, fmtPct, monthLabel, APP_BUILD } from '../lib/ui-helpers';
import { pinnedKeyOf } from '../lib/compare-grid';
import { changeCap, changeColor, formatChange } from '../lib/market-change';

const PIN_PRICE_KEY = 'apt-dashboard-pin-price';
const PIN_PRICE_MODES = [['deal', '최근 거래'], ['p34', '34평'], ['unit', '평당가']];

// 지도 탭 전체(왼쪽 패널 + 지도 + 툴바 + 단지 탐색 패널). app/page.jsx 안에 있던
// viewMode === 'map' 블록과 renderSeoulMap()을 그대로 옮긴 것으로, 로직은 바꾸지 않았다.
export default function MapTab({
  selectedApt,
  pinnedComplexes, setPinnedComplexes, complexCompare,
  panelOpen, setPanelOpen, sidebarInner, styles,
  mapError, seoulMapData, addRegionAndFetch, focusLatLng,
  mapFocusMatches, budgetMatches, priceMoveMatches, mapComplexes,
  setSelectedApt, dongMapData, setMapZoomTier, setMapViewportBounds, setVisibleMarkerCount, visibleStations,
  schoolLayerOn, setSchoolLayerOn, visibleSchoolLocations, schoolLocationsLoading,
  geocodeStats, setGeocodeStats, mapZoomTier, detailInset = 420, setViewMode,
  dealType, setDealTypeSafe, isRone, isRatio, isRent,
  mapColorMode, setMapColorMode,
  budgetSearchOpen, setBudgetSearchOpen, budgetAmount, setBudgetAmount,
  dongLayerOn, setDongLayerOn,
  subwayLayerOn, setSubwayLayerOn,
  priceMoveFilter, setPriceMoveFilter,
  setMapFocusKeys,
  selected, allTx, visibleMarkerCount,
  months, timelineMonth, setTimelineMonth,
  mapPanelMinimized, setMapPanelMinimized,
  mapViewportBounds, mapPanelList,
  mapComplexCoordByKey, codeToLatLng, setFocusLatLng,
  unitSizeFilter, setUnitSizeFilter, buildYearFilter, setBuildYearFilter,
  complexGapList, setGapListOn, browseRegionCount = 0,
  stationInfoOf, listStation = 'all', setListStation, listGeoTick = 0,
  schoolInfoOf, listSchool = 'all', setListSchool, elemSchools = null,
  householdsOf, listHH = 'all', setListHH, hhData = null,
  setSchoolWanted, setHhWanted,
}) {
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);
  const [listOnlyOpen, setListOnlyOpen] = useState(false);
  const [panelView, setPanelView] = useState('complexes'); // 오른쪽 패널: 'complexes'(단지) | 'trades'(최근 거래·신고가) | 'gap'(34평 갭 순위, v200)
  // v201: 갭 순위 조건 — 준공 연식(년 이내, 'all'이면 전체)·34평 매매 최소 건수.
  const [gapAge, setGapAge] = useState('all');
  const [gapMinN, setGapMinN] = useState(2);
  const [gapStation, setGapStation] = useState('all'); // v204: 가장 가까운 지하철역까지 직선거리(m) 이내, 'all'이면 전체
  // v214: 초등학교 거리·세대수 조건(단지 탭과 같은 자료를 쓰되 조건은 따로). 학교 위치·세대수는 받기 전엔 거르지 않는다.
  const [gapSchool, setGapSchool] = useState('all'); // 'all' | '300' | '500' (m 이내)
  const [gapHH, setGapHH] = useState('all'); // 'all' | '300' | '500' | '1000' (세대 이상)
  const gapRows = useMemo(() => {
    if (!complexGapList) return null;
    const thisYear = new Date().getFullYear();
    return complexGapList.filter((g) => {
      if (g.nSale < gapMinN) return false;
      if (gapAge !== 'all' && !(g.buildYear && thisYear - g.buildYear <= Number(gapAge))) return false;
      if (gapStation !== 'all' && !(g.stationM != null && g.stationM <= Number(gapStation))) return false;
      if (gapSchool !== 'all' && schoolInfoOf && elemSchools) {
        const sc = schoolInfoOf(g.regionCode, g.dong, g.apt);
        if (sc == null || sc.m > Number(gapSchool)) return false;
      }
      if (gapHH !== 'all' && householdsOf) {
        const h = householdsOf(g.regionCode, g.dong, g.apt);
        if (h !== undefined && (h == null || h < Number(gapHH))) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complexGapList, gapAge, gapMinN, gapStation, gapSchool, gapHH, elemSchools, hhData]);
  // 갭 순위 탭에서 학교·세대수 조건을 켜면 page.jsx가 그 자료를 받도록 알린다.
  useEffect(() => {
    if (setSchoolWanted) setSchoolWanted(panelView === 'gap' && gapSchool !== 'all');
    if (setHhWanted) setHhWanted(panelView === 'gap' && gapHH !== 'all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelView, gapSchool, gapHH]);
  // 갭 순위 탭을 열었을 때만 page.jsx가 전월세를 받아 계산한다. 매매가 아니면 탭이 없으므로 단지 탭으로 돌린다.
  useEffect(() => {
    if (panelView === 'gap' && dealType !== 'trade') { setPanelView('complexes'); return; }
    if (setGapListOn) setGapListOn(panelView === 'gap');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelView, dealType]);
  // 숫자 원을 누르면 그 안의 단지 목록을 오른쪽 패널에 보여준다(갈라질 수 있으면 지도도 확대된다).
  const [clusterKeys, setClusterKeys] = useState(null); // Set<string> | null
  const clusterRows = useMemo(() => {
    if (!clusterKeys) return null;
    const rows = mapComplexes.filter((c) => clusterKeys.has(c.key));
    return rows.length ? rows : null;
  }, [clusterKeys, mapComplexes]);
  // 지도 위 검색(v184): 단지명·동으로 핀과 목록을 좁힌다(띄어쓰기·대소문자 무시). 목록은 화면 범위와 상관없이
  // 조회한 지역 전체에서 찾는다. 검색어가 없으면 원래 배열을 그대로 넘긴다(참조가 바뀌면 지도가 마커를 다시 그린다, 규칙 3).
  const [mapKeyword, setMapKeyword] = useState('');
  const kwNorm = mapKeyword.replace(/\s+/g, '').toLowerCase();
  const matchKw = useCallback((c) => (
    String(c.apt || '').replace(/\s+/g, '').toLowerCase().includes(kwNorm) || String(c.dong || '').includes(kwNorm)
  ), [kwNorm]);
  // 핀 가격 기준(v196): 평형이 섞인 "최근 거래" 대신 34평 기준이나 평당가로 단지끼리 바로 비교할 수 있게. 고른 값은 이 브라우저에 기억한다.
  const [pinPriceMode, setPinPriceMode] = useState('deal');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PIN_PRICE_KEY);
      if (PIN_PRICE_MODES.some(([k]) => k === saved)) setPinPriceMode(saved);
    } catch (e) { /* 저장소를 못 쓰면 기본값 */ }
  }, []);
  const choosePinPriceMode = (k) => {
    setPinPriceMode(k);
    try { window.localStorage.setItem(PIN_PRICE_KEY, k); } catch (e) { /* 저장 실패는 무시 */ }
  };
  const pinBase = mapFocusMatches || budgetMatches || priceMoveMatches || mapComplexes;
  // v207: 역 거리 조건. "현재 화면" 목록은 page.jsx가 이미 걸러서 주고, 검색·묶음·예산 목록은 여기서 거른다.
  // v211: 초등학교 거리 조건도 같이 본다(학교 위치를 받기 전엔 거르지 않는다).
  const stationOn = listStation !== 'all' && !!stationInfoOf;
  const schoolOn = listSchool !== 'all' && !!schoolInfoOf && !!elemSchools;
  const hhOn = listHH !== 'all' && !!householdsOf; // v212: 세대수 이상
  const locOn = stationOn || schoolOn || hhOn;
  const nearStation = (c) => {
    if (stationOn) {
      const st = stationInfoOf(c.regionCode, c.dong, c.apt);
      if (st == null || st.m > Number(listStation)) return false;
    }
    if (schoolOn) {
      const sc = schoolInfoOf(c.regionCode, c.dong, c.apt);
      if (sc == null || sc.m > Number(listSchool)) return false;
    }
    if (hhOn) {
      const h = householdsOf(c.regionCode, c.dong, c.apt);
      if (h !== undefined && (h == null || h < Number(listHH))) return false; // 그 구를 아직 안 받았으면 거르지 않는다
    }
    return true;
  };
  const kwRows = useMemo(
    () => (kwNorm ? complexCompare.filter((c) => matchKw(c) && nearStation(c)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [complexCompare, kwNorm, matchKw, listStation, listSchool, elemSchools, listHH, hhData],
  );
  // 예: "역 500m·초교 300m 이내·500세대 이상"
  const distLabel = [stationOn && `역 ${listStation === '500' ? '500m' : '1km'}`, schoolOn && `초교 ${listSchool}m`].filter(Boolean).join('·');
  const locLabel = [distLabel && `${distLabel} 이내`, hhOn && `${Number(listHH).toLocaleString()}세대 이상`].filter(Boolean).join('·');
  const chipStyle = (on) => ({
    flexShrink: 0, border: `1px solid ${on ? PALETTE.accent : PALETTE.border}`, borderRadius: 999, padding: '5px 10px', whiteSpace: 'nowrap',
    background: on ? PALETTE.accent : '#fff', color: on ? '#fff' : PALETTE.textSecondary, fontSize: 11.5, fontWeight: on ? 700 : 500, cursor: 'pointer',
  });
  // "목록만" 진단은 펼쳤을 때만 계산한다 (단지가 수백 개라 평소엔 돌릴 필요가 없다).
  const listOnlyReport = useMemo(
    () => (listOnlyOpen ? classifyListOnly(mapComplexes) : null),
    [listOnlyOpen, mapComplexes],
  );

  // 비교함에 담은 단지 키(지도에서 ★로 강조). pinnedComplexes가 바뀔 때만 새 Set을 만들어 지도가 불필요하게 다시 그려지지 않게 한다.
  const pinnedKeys = useMemo(() => new Set((pinnedComplexes || []).map(pinnedKeyOf)), [pinnedComplexes]);
  // 지도 핀: 검색어와 역 거리 조건(v209)으로 거른다. 비교함 단지(★)는 조건과 상관없이 남긴다.
  // 조건이 없으면 원래 배열을 그대로 넘긴다(참조가 바뀌면 지도가 마커를 다시 그린다, 규칙 3).
  // 정확한 좌표를 새로 받으면(listGeoTick) 다시 거른다.
  const pinComplexes = useMemo(() => {
    if (!kwNorm && !locOn) return pinBase;
    return pinBase.filter((c) => (!kwNorm || matchKw(c)) && (pinnedKeys.has(c.key) || nearStation(c)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinBase, kwNorm, matchKw, listStation, listSchool, elemSchools, listHH, hhData, listGeoTick, pinnedKeys]);
  // 비교함 → "지도에서 이 단지들만 보기": 기존 "비교 목록만 보는 중" 필터를 쓰고, 좌표를 아는 첫 단지로 지도를 옮긴다.
  const focusPinnedOnMap = (keys) => {
    setMapFocusKeys(new Set(keys));
    const first = keys.map((k) => mapComplexCoordByKey.get(k)).find((c) => c && c.lat != null && c.lng != null);
    if (first) setFocusLatLng({ lat: first.lat, lng: first.lng });
  };

  // 위쪽 도구줄(거래유형·예산·레이어 + 상태 카드)의 실제 높이. 오른쪽 "단지 탐색" 패널을 그 바로 아래에 놓아서
  // 카드가 길어져도 패널 머리글을 덮지 않게 한다. (예전엔 패널 top이 72px로 고정이라 카드가 5~6줄이면 겹쳤다)
  const [topRowH, setTopRowH] = useState(0);
  const topRowObserverRef = useRef(null);
  const topRowRef = useCallback((el) => {
    if (topRowObserverRef.current) { topRowObserverRef.current.disconnect(); topRowObserverRef.current = null; }
    if (!el) return;
    const measure = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      setTopRowH((prev) => (prev === h ? prev : h));
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      topRowObserverRef.current = new ResizeObserver(measure);
      topRowObserverRef.current.observe(el);
    }
  }, []);
  // 지도 영역이 좁을 때(작은 노트북·태블릿·창 나눔, 약 720~1100px 화면)는 떠 있는 카드와 목록이 지도를 거의 다 가렸다
  // (v169 실측: 800px 창에서 보이는 지도 폭 70~80px). 지도 폭을 재서 좁으면 카드는 요약만, 목록은 접힌 채로 시작한다.
  // 720px 이하는 page.jsx의 모바일 CSS가 따로 처리한다.
  const [mapW, setMapW] = useState(0);
  const mapObserverRef = useRef(null);
  const mapAreaRef = useCallback((el) => {
    if (mapObserverRef.current) { mapObserverRef.current.disconnect(); mapObserverRef.current = null; }
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      setMapW((prev) => (prev === w ? prev : w));
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      mapObserverRef.current = new ResizeObserver(measure);
      mapObserverRef.current.observe(el);
    }
  }, []);
  const compact = mapW > 0 && mapW < 820;
  const [statusOpen, setStatusOpen] = useState(false);
  // 좁아지는 순간 한 번만 목록을 접는다(사용자가 다시 펼치면 그대로 둔다). v186부터 폰도 접힌 채 시작해
  // 지도를 넓게 보여주고, 아래쪽 "단지 탐색 N개 · 목록 열기" 막대로 연다.
  const autoMinimizedRef = useRef(false);
  useEffect(() => {
    if (compact && !autoMinimizedRef.current && typeof window !== 'undefined') {
      autoMinimizedRef.current = true;
      setMapPanelMinimized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact]);
  // 1100px 미만(중간 폭·폰)에서는 처음 들어올 때 필터 패널을 접어서 지도를 넓게 보여준다.
  // 폰(720px 이하)은 패널이 위 58%를 차지해 지도가 거의 안 보였다(v172 실측) — 위쪽 "조건 설정" 막대로 다시 펼친다.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window.innerWidth;
    if (w < 1100 && panelOpen) setPanelOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderSeoulMap = () => {
    const heroWrap = (content) => (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>{content}</div>
    );
    const emptyState = (msg) => heroWrap(
      <div style={{
        width: '100%', height: '100%', background: PALETTE.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: PALETTE.textMuted, fontSize: 13, textAlign: 'center', padding: 20,
      }}>
        {msg}
      </div>,
    );
    if (mapError) return emptyState(mapError);
    if (!seoulMapData) return emptyState('지도 불러오는 중...');

    const pathGen = null; // SVG 폴백에서만 쓰이며 아래에서 필요 시 다시 만든다.
    // 가격변동 모드: 0을 가운데로 빨강(상승) ↔ 파랑(하락). 구와 동 값을 함께 보고 가장 진한 색의 기준(%)을 정한다.
    const isChangeMode = mapColorMode === 'change' || mapColorMode === 'volchange';
    const changeCapValue = isChangeMode
      ? changeCap(
        [...(seoulMapData.values || []), ...((dongMapData && dongMapData.values) || [])],
        mapColorMode === 'volchange' ? { min: 20, max: 100 } : undefined, // 거래량은 가격보다 훨씬 크게 출렁인다
      )
      : null;
    const colorFor = (value) => {
      if (value == null) return PALETTE.panelAlt;
      if (isChangeMode) return changeColor(value, changeCapValue) || PALETTE.panelAlt;
      const { min, max } = seoulMapData;
      const t = max > min ? (value - min) / (max - min) : 0.5;
      const from = [245, 244, 239];
      const to = [178, 58, 46];
      const mix = from.map((c, i) => Math.round(c + (to[i] - c) * t));
      return `rgb(${mix.join(',')})`;
    };

    return heroWrap(
      <>
        {process.env.NEXT_PUBLIC_NAVER_MAP_KEY_ID ? (
          <NaverChoropleth
            features={seoulMapData.features}
            values={seoulMapData.values}
            colorFor={colorFor}
            valueFormat={mapColorMode === 'change' || mapColorMode === 'volchange' ? formatChange : mapColorMode === 'gap' ? fmtWon : undefined}
            valueNotes={seoulMapData.notes}
            dongValueNotes={dongMapData?.notes}
            borderColor={PALETTE.border}
            onSelect={(code) => addRegionAndFetch(code)}
            focusLatLng={focusLatLng}
            complexes={pinComplexes}
            onComplexSelect={(c) => setSelectedApt({ apt: c.apt, dong: c.dong, regionCode: c.regionCode, lat: c.lat, lng: c.lng })}
            dongFeatures={dongMapData?.features}
            dongValues={dongMapData?.values}
            onZoomTierChange={setMapZoomTier}
            onViewportChange={setMapViewportBounds}
            onVisibleMarkerCount={setVisibleMarkerCount}
            onGeocodeStats={setGeocodeStats}
            onClusterOpen={(keys) => { setClusterKeys(new Set(keys)); setPanelView('complexes'); setMapPanelMinimized(false); }}
            pinnedKeys={pinnedKeys}
            pinPriceMode={pinPriceMode}
            stations={visibleStations}
            schools={visibleSchoolLocations}
            height="100%"
          />
        ) : process.env.NEXT_PUBLIC_KAKAO_MAP_KEY ? (
          <KakaoChoropleth
            features={seoulMapData.features}
            values={seoulMapData.values}
            colorFor={colorFor}
            borderColor={PALETTE.border}
            onSelect={(code) => addRegionAndFetch(code)}
            focusLatLng={focusLatLng}
            complexes={pinComplexes}
            onComplexSelect={(c) => setSelectedApt({ apt: c.apt, dong: c.dong, regionCode: c.regionCode, lat: c.lat, lng: c.lng })}
            dongFeatures={dongMapData?.features}
            dongValues={dongMapData?.values}
            onZoomTierChange={setMapZoomTier}
            onViewportChange={setMapViewportBounds}
            onVisibleMarkerCount={setVisibleMarkerCount}
            height="100%"
          />
        ) : (
          <svg viewBox="0 0 560 480" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block', background: PALETTE.bg }}>
            {seoulMapData.features.map((f, idx) => {
              const value = seoulMapData.values[idx];
              return (
                <path
                  key={f.name + idx}
                  d={pathGen ? pathGen(f.feature) : ''}
                  fill={colorFor(value)}
                  stroke={PALETTE.border}
                  strokeWidth={0.75}
                  style={{ cursor: f.code ? 'pointer' : 'default' }}
                  onClick={() => f.code && addRegionAndFetch(f.code)}
                >
                  <title>{f.name}{value != null ? `: ${Math.round(value).toLocaleString()}` : ' (데이터 없음)'}</title>
                </path>
              );
            })}
          </svg>
        )}
        {seoulMapData.max > seoulMapData.min && (
          <div style={{
            position: 'absolute', left: 16, bottom: 16, zIndex: 20,
            background: 'rgba(255,255,255,0.94)', border: `1px solid ${PALETTE.border}`, borderRadius: 8,
            padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 10.5, color: PALETTE.textSecondary, boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          }}>
            <span>낮음</span>
            <div style={{
              width: 90, height: 8, borderRadius: 4,
              background: `linear-gradient(90deg, rgb(245,244,239), ${PALETTE.accent})`,
            }} />
            <span>높음</span>
          </div>
        )}
      </>,
    );
  };

  return (
    <div className="hero-wrap" style={{ display: 'flex', width: '100%', height: '100vh', overflow: 'hidden' }}>
      {panelOpen ? (
        <>
        <aside
          style={{
            ...styles.sidebar,
            width: 300, flexShrink: 0, height: '100%', minHeight: 0, overflowY: 'auto',
            borderRight: `1px solid ${PALETTE.border}`,
          }}
          className="dash-sidebar-fixed"
        >
          {sidebarInner}
        </aside>
          {/* 폰에서만 보인다(page.jsx 모바일 CSS). 예전엔 폰에서 패널을 접을 방법이 없었다. */}
          <button className="panel-collapse-mobile" onClick={() => setPanelOpen(false)} style={{ display: 'none' }}>
            지도 크게 보기 ▴
          </button>
        </>
      ) : (
        <button
          className="panel-expand-btn"
          onClick={() => setPanelOpen(true)}
          style={{
            width: 28, flexShrink: 0, height: '100%', border: 'none', borderRight: `1px solid ${PALETTE.border}`,
            background: PALETTE.panel, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-label="패널 펼치기"
        >
          <ChevronRight size={16} color={PALETTE.textMuted} />
          <span className="panel-expand-label" style={{ display: 'none' }}>조건 설정 (지역·기간·평형)</span>
        </button>
      )}

      <div ref={mapAreaRef} style={{ position: 'relative', flex: 1, touchAction: 'none', minWidth: 0 }}>
        {renderSeoulMap()}

        <PinnedCompareDrawer
          pinnedComplexes={pinnedComplexes} setPinnedComplexes={setPinnedComplexes}
          complexCompare={complexCompare} setSelectedApt={setSelectedApt} isRent={isRent}
          onFocusMap={focusPinnedOnMap}
          onOpenCompareTab={setViewMode ? () => setViewMode('compare') : undefined}
        />

        {/* 지도 위 탐색 도구: 거래유형을 사이드바로 안 가고 바로 바꿀 수 있게 */}
        <div className="map-portal-toolbar" ref={topRowRef} style={{
          position: 'absolute', top: 14, left: 14, right: 14 + (selectedApt ? detailInset : 0), zIndex: 20,
          // 자리가 모자라면 상태 카드가 다음 줄로 내려오게 한다 (예전엔 한 줄에 억지로 두어서 카드가 오른쪽으로 삐져나가
          // 상세 창 밑에 가려졌다).
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, pointerEvents: 'none', transition: 'right 0.15s ease',
        }}>
          <div style={{
            pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 4,
            background: 'rgba(255,255,255,0.96)', border: `1px solid ${PALETTE.border}`,
            borderRadius: 12, padding: 5, boxShadow: '0 4px 18px rgba(0,0,0,0.10)',
            backdropFilter: 'blur(8px)', overflowX: 'auto', maxWidth: 'calc(100% - 10px)',
          }}>
            {[['trade', '매매'], ['rent', '전월세'], ['silv', '분양권'], ['rone', '시세동향'], ['ratio', '전세가율']].map(([key, label]) => (
              <button key={key} className="portal-pill" onClick={() => setDealTypeSafe(key)} style={{
                border: 'none', borderRadius: 9, padding: '8px 12px', whiteSpace: 'nowrap',
                background: dealType === key ? PALETTE.accent : 'transparent',
                color: dealType === key ? '#fff' : PALETTE.textSecondary,
                fontSize: 12, fontWeight: dealType === key ? 700 : 500, cursor: 'pointer',
              }}
              >
                {label}
              </button>
            ))}
          </div>
          {!isRatio && !isRone && (
            <div style={{
              pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(255,255,255,0.96)', border: `1px solid ${budgetSearchOpen ? PALETTE.accent : PALETTE.border}`,
              borderRadius: 12, padding: '5px 8px', boxShadow: '0 4px 18px rgba(0,0,0,0.10)',
              backdropFilter: 'blur(8px)',
            }}
            >
              <button
                className="portal-pill"
                onClick={() => setBudgetSearchOpen((v) => !v)}
                style={{
                  border: 'none', borderRadius: 9, padding: '6px 10px', whiteSpace: 'nowrap',
                  background: budgetSearchOpen ? PALETTE.accent : 'transparent',
                  color: budgetSearchOpen ? '#fff' : PALETTE.textSecondary,
                  fontSize: 12, fontWeight: budgetSearchOpen ? 700 : 500, cursor: 'pointer',
                }}
              >
                💰 예산으로 찾기
              </button>
              {budgetSearchOpen && (
                <>
                  <input
                    type="number"
                    placeholder="예: 6"
                    value={budgetAmount}
                    onChange={(e) => setBudgetAmount(e.target.value)}
                    style={{ width: 60, padding: '5px 6px', borderRadius: 6, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                  />
                  <span style={{ fontSize: 11.5, color: PALETTE.textMuted }}>억 이하</span>
                </>
              )}
            </div>
          )}
          <div style={{ pointerEvents: 'auto', position: 'relative' }}>
            <button
              className="portal-pill"
              onClick={() => setLayerPanelOpen((v) => !v)}
              style={{
                border: `1px solid ${layerPanelOpen ? PALETTE.accent : PALETTE.border}`, borderRadius: 12,
                padding: '9px 12px', background: 'rgba(255,255,255,0.96)', boxShadow: '0 4px 18px rgba(0,0,0,0.10)',
                fontSize: 12, fontWeight: 700,
                color: layerPanelOpen ? PALETTE.accent : PALETTE.textPrimary, whiteSpace: 'nowrap',
              }}
            >
              🗂️ 레이어
            </button>
            {layerPanelOpen && (
              <div style={{
                position: 'absolute', top: '110%', left: 0, width: 230, zIndex: 25,
                background: 'rgba(255,255,255,0.98)', border: `1px solid ${PALETTE.border}`, borderRadius: 12,
                boxShadow: '0 8px 24px rgba(0,0,0,0.14)', padding: 10, backdropFilter: 'blur(10px)',
              }}
              >
                {!isRone && !isRatio && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10.5, color: PALETTE.textMuted, marginBottom: 4 }}>색칠 기준</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {[['price', '가격'], ['volume', '거래량'], ['change', '가격변동'], ['volchange', '거래량변동'], ...(dealType === 'trade' ? [['gap', '34평 갭']] : [])].map(([key, label]) => (
                        <button key={key} onClick={() => setMapColorMode(key)} style={{
                          flex: '1 1 calc(50% - 4px)', whiteSpace: 'nowrap', border: `1px solid ${mapColorMode === key ? PALETTE.textPrimary : PALETTE.border}`, borderRadius: 8, padding: '6px 0',
                          background: mapColorMode === key ? PALETTE.textPrimary : 'transparent',
                          color: mapColorMode === key ? '#fff' : PALETTE.textSecondary,
                          fontSize: 11.5, fontWeight: mapColorMode === key ? 700 : 500, cursor: 'pointer',
                        }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {(mapColorMode === 'change' || mapColorMode === 'volchange') && (
                      <div data-change-help="1" style={{ marginTop: 6, fontSize: 10, lineHeight: 1.5, color: PALETTE.textMuted }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                          <span style={{ width: 34, height: 7, borderRadius: 4, background: `linear-gradient(90deg, ${changeColor(-100, 1)}, ${changeColor(0, 1)}, ${changeColor(100, 1)})` }} />
                          <span>하락 ← → 상승</span>
                        </div>
                        {mapColorMode === 'volchange'
                          ? '조회 기간의 앞 절반 → 뒤 절반 거래 건수 변화예요. 앞 기간이 5건 미만인 곳은 %가 크게 부풀려져서 회색으로 두었어요. 거래가 사라지면 -100%예요.'
                          : '조회 기간의 앞 절반 → 뒤 절반 평균 평당가 변화예요. 거래된 단지 구성에 따라 실제 시세와 다를 수 있고, 표본이 적은 곳(각 기간 3건 미만)은 회색이에요.'}
                        {' '}마우스를 올리면 근거가 되는 건수가 나와요.
                      </div>
                    )}
                    {mapColorMode === 'gap' && (
                      <div style={{ marginTop: 6, fontSize: 10, lineHeight: 1.5, color: PALETTE.textMuted }}>
                        조회 기간 34평(전용 약 84㎡) 매매 중간값 − 전세 중간값이에요. 진할수록 전세를 끼고 살 때 필요한 돈(갭)이 커요.
                        34평 매매·전세가 각각 2건 미만인 곳은 회색. 마우스를 올리면 매매·전세 값과 건수가 나와요.
                      </div>
                    )}
                  </div>
                )}
                <div
                  onClick={() => setDongLayerOn((v) => !v)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 2px', cursor: 'pointer' }}
                  title="끄면 동 경계·색칠을 아예 안 그려서 단지 마커 표시에 더 집중해요"
                >
                  <span style={{ fontSize: 12 }}>🗺️ 동 경계·색칠</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: dongLayerOn ? PALETTE.up : PALETTE.textMuted }}>{dongLayerOn ? '켜짐' : '꺼짐'}</span>
                </div>
                <div
                  onClick={() => setSubwayLayerOn((v) => !v)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 2px', cursor: 'pointer' }}
                  title="화면에 보이는 범위의 지하철역을 지도에 표시해요"
                >
                  <span style={{ fontSize: 12 }}>🚇 지하철역</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: subwayLayerOn ? PALETTE.up : PALETTE.textMuted }}>{subwayLayerOn ? '켜짐' : '꺼짐'}</span>
                </div>
                <div
                  onClick={() => setSchoolLayerOn((v) => !v)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 2px', cursor: 'pointer' }}
                  title="화면에 보이는 범위의 초·중학교를 지도에 표시해요"
                >
                  <span style={{ fontSize: 12 }}>🏫 학교{schoolLocationsLoading ? ' (불러오는 중)' : ''}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: schoolLayerOn ? PALETTE.up : PALETTE.textMuted }}>{schoolLayerOn ? '켜짐' : '꺼짐'}</span>
                </div>
                {!isRent && !isRatio && !isRone && (
                  <div style={{ marginTop: 6, paddingTop: 8, borderTop: `1px solid ${PALETTE.border}` }}>
                    <div style={{ fontSize: 10.5, color: PALETTE.textMuted, marginBottom: 4 }}>단지 필터</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[['all', '전체'], ['high', '📈 신고가'], ['drop', '📉 하락']].map(([k, l]) => (
                        <button
                          key={k}
                          onClick={() => setPriceMoveFilter(k)}
                          style={{
                            flex: 1, border: `1px solid ${priceMoveFilter === k ? PALETTE.textPrimary : PALETTE.border}`, borderRadius: 8, padding: '6px 0',
                            background: priceMoveFilter === k ? PALETTE.textPrimary : 'transparent',
                            color: priceMoveFilter === k ? '#fff' : PALETTE.textSecondary,
                            fontSize: 11, fontWeight: priceMoveFilter === k ? 700 : 500, cursor: 'pointer',
                          }}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="map-status-card" style={{
            marginLeft: 'auto', pointerEvents: 'auto', background: 'rgba(255,255,255,0.96)',
            border: `1px solid ${PALETTE.border}`, borderRadius: 12, padding: '9px 12px',
            boxShadow: '0 4px 18px rgba(0,0,0,0.10)', fontSize: 11.5,
            // 긴 진단 줄이 잘리거나 가려지지 않게 줄바꿈을 허용하고, 컨테이너 폭을 넘지 않게 한다.
            whiteSpace: 'normal', overflowWrap: 'anywhere', maxWidth: '100%', boxSizing: 'border-box',
          }}>
            {mapFocusMatches ? (
              <>
                <b>{mapFocusMatches.length.toLocaleString()}</b>개 단지 · 비교 목록만 보는 중{' '}
                <span style={{ cursor: 'pointer', color: PALETTE.accent, textDecoration: 'underline' }} onClick={() => setMapFocusKeys(null)}>전체 보기</span>
              </>
            ) : budgetMatches ? (
              <><b>{budgetMatches.length.toLocaleString()}</b>개 단지가 예산 이내</>
            ) : priceMoveMatches ? (
              <><b>{priceMoveMatches.length.toLocaleString()}</b>개 단지 · {priceMoveFilter === 'high' ? '신고가 후보(변동률 +5%↑)' : '하락 후보(변동률 -5%↓)'}</>
            ) : (
              <>
                <b>{selected.length}</b>개 지역 · <b>{allTx.length.toLocaleString()}</b>건 조회
                {browseRegionCount > 0 && (
                  <span title="지도로 보고 있는 주변 구를 자동으로 불러와 핀만 보여 줘요. 대시보드·순위는 선택한 지역 기준이에요.">
                    {' '}· 주변 <b>{browseRegionCount}</b>곳 자동 표시
                  </span>
                )}
                {compact && mapComplexes.length > 0 && (
                  <span
                    style={{ marginLeft: 6, cursor: 'pointer', color: PALETTE.accent, fontSize: 10.5 }}
                    onClick={() => setStatusOpen((v) => !v)}
                  >
                    {statusOpen ? '접기 ▴' : '자세히 ▾'}
                  </span>
                )}
                {compact && !statusOpen && mapZoomTier !== 'near' && mapComplexes.length > 0 && (
                  <div style={{ fontSize: 10, color: PALETTE.accent, marginTop: 2 }}>단지 마커는 지도를 더 확대하면 보여요</div>
                )}
                {(!compact || statusOpen) && mapComplexes.length > 0 && (() => {
                  const withTrade = mapComplexes.filter((c) => c.latestPrice != null).length;
                  // 지역을 바꾼 직후에는 이전 지역의 통계가 남아 있을 수 있어서, 단지 수가 맞을 때만 보여준다.
                  const gs = geocodeStats && geocodeStats.total === mapComplexes.length ? geocodeStats : null;
                  return (
                    <div style={{ fontSize: 10, color: PALETTE.textMuted, marginTop: 2, lineHeight: 1.5 }}>
                      <div title="거래: 조회 기간에 거래가 있는 단지 · 목록만: 단지 목록에는 있지만 이 기간 거래가 없는 단지 (표기가 많이 달라 합치지 못한 같은 단지가 섞여 있을 수 있어요) · 합침: 거래 단지와 이름이 사실상 같아 중복으로 보고 합친 수">
                        단지 {mapComplexes.length}개 (거래 {withTrade} · 목록만 {mapComplexes.length - withTrade})
                        {mapComplexes.mergedByName > 0 && ` · 이름 같아 합침 ${mapComplexes.mergedByName}`}
                        {visibleMarkerCount != null && ` · 화면표시 ${visibleMarkerCount}개`}
                      </div>
                      {mapComplexes.length - withTrade > 0 && (
                        <div>
                          <span
                            style={{ cursor: 'pointer', textDecoration: 'underline', color: PALETTE.textSecondary }}
                            onClick={() => setListOnlyOpen((v) => !v)}
                          >
                            {listOnlyOpen ? '▾ 목록만 단지 살펴보기 접기' : '▸ 목록만 단지, 왜 많을까? 살펴보기'}
                          </span>
                          {listOnlyReport && (
                            <div style={{ marginTop: 3, padding: '6px 8px', background: PALETTE.panelAlt, borderRadius: 6 }}>
                              <div>목록만 {listOnlyReport.listOnly}개를 이름으로 비교했어요</div>
                              <div>· 같은 동에 비슷한 이름의 거래 단지가 있음: <b>{listOnlyReport.sameDong}</b>개 (같은 단지일 수 있어요)</div>
                              <div>· 다른 동에만 비슷한 이름이 있음: <b>{listOnlyReport.otherDong}</b>개</div>
                              <div>· 비슷한 이름이 없음: <b>{listOnlyReport.none}</b>개 (이 기간 거래가 정말 없는 단지로 보여요)</div>
                              {listOnlyReport.samples.length > 0 && (
                                <div style={{ marginTop: 4 }}>
                                  <div style={{ color: PALETTE.textSecondary }}>같은 동 후보 예시 (목록 이름 ↔ 거래 이름)</div>
                                  {listOnlyReport.samples.map((m) => (
                                    <div key={`${m.dong}|${m.list}|${m.trade}`}>{m.dong} · {m.list} ↔ {m.trade}</div>
                                  ))}
                                </div>
                              )}
                              <div style={{ marginTop: 4, color: PALETTE.textMuted }}>
                                번호가 다르면(6단지/7단지, 1차/2차) 다른 단지로 봤어요. 이 숫자는 같은 단지라고 단정한 게 아니라 "비슷해 보이는 후보"예요.
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {gs && (
                        <div title="정확: 카카오·저장된 실제 위치 · 동 중심: 같은 동 단지는 한 점에 겹쳐 보여요 · 못 찾음: 위치를 못 찾아 표시하지 않아요 · 대기: 아직 위치 검색 전(확대해서 보이면 찾아요)">
                          위치 정확 {gs.exact} · 동 중심 {gs.approx} · 못 찾음 {gs.failed} · 대기 {gs.pending}
                        </div>
                      )}
                      {gs && gs.server && gs.server.asked > 0 && (
                        <div title="다른 방문자나 예열로 이미 서버에 저장된 위치를 찾은 비율이에요. 예열과 '기존 좌표 변환'을 한 뒤에 이 비율이 올라가야 해요. (이번 접속에서 처음 물어본 단지 기준)">
                          서버 저장분: 조회 {gs.server.asked} → 적중 {gs.server.hit} ({Math.round((gs.server.hit / gs.server.asked) * 100)}%)
                        </div>
                      )}
                      {gs && gs.refine && (gs.refine.attempted > 0 || gs.refine.sdkFail > 0 || gs.kakao.calls > 0) && (
                        <div title="동 중심에 겹쳐 있는 단지의 정확한 위치를 카카오에서 찾는 중이에요. 결과없음: 검색 결과가 없음 · 지역불일치: 결과는 있었지만 시·도/시군구가 맞지 않아 버림 · 오류: 카카오 응답 오류">
                          위치 다듬기: 시도 {gs.refine.attempted} · 이동 {gs.refine.moved}
                          {` · 카카오 ${gs.kakao.calls}회(채택 ${gs.kakao.picked} · 결과없음 ${gs.kakao.zero} · 지역불일치 ${gs.kakao.rejected} · 오류 ${gs.kakao.error}${gs.kakao.lastError ? `:${gs.kakao.lastError}` : ''})`}
                          {gs.refine.far > 0 && ` · 동에서 멀어 버림 ${gs.refine.far}`}
                        </div>
                      )}
                      {gs && gs.refine && gs.refine.sdkFail > 0 && (
                        <div style={{ color: '#B23A2E' }}>카카오 지도 SDK를 불러오지 못했어요 (카카오 개발자 콘솔의 웹 도메인 등록을 확인해주세요)</div>
                      )}
                      {mapZoomTier !== 'near' && (
                        <div style={{ color: PALETTE.accent }}>단지 마커는 지도를 더 확대하면 보여요</div>
                      )}
                      <div style={{ opacity: 0.6 }}>빌드 {APP_BUILD}</div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
          {/* 지도 위 검색·필터(v184): 단지명·동 검색 + 평형·연식. 평형·연식은 왼쪽 조건 패널과 같은 값을 바꾼다.
              넓은 화면에서는 오른쪽 단지 목록 창과 안 겹치게 폭을 줄이고, 폰은 page.jsx CSS에서 전체 폭. */}
          {mapComplexes.length > 0 && (
            <div style={{ flexBasis: '100%', minWidth: 0, maxWidth: '100%', display: 'flex', pointerEvents: 'none' }}>
              <div className="map-filter-row" style={{
                pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: 'min(640px, calc(100% - 280px))', scrollbarWidth: 'thin',
                overflowX: 'auto', background: 'rgba(255,255,255,0.96)', border: `1px solid ${PALETTE.border}`,
                borderRadius: 12, padding: '5px 8px', boxShadow: '0 4px 18px rgba(0,0,0,0.10)', backdropFilter: 'blur(8px)',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: '0 6px', borderRadius: 8, background: '#fff',
                  border: `1px solid ${mapKeyword ? PALETTE.accent : PALETTE.border}`,
                }}>
                  <span style={{ fontSize: 12 }}>🔍</span>
                  <input
                    value={mapKeyword}
                    onChange={(e) => { setMapKeyword(e.target.value); setPanelView('complexes'); setMapPanelMinimized(false); }}
                    placeholder="단지명·동 검색"
                    style={{ width: 120, border: 'none', outline: 'none', padding: '6px 0', fontSize: 12, background: 'transparent' }}
                  />
                  {mapKeyword && <span style={{ cursor: 'pointer', color: PALETTE.textMuted, fontSize: 13 }} onClick={() => setMapKeyword('')}>✕</span>}
                </div>
                {!isRone && !isRatio && (
                  <>
                    <span style={{ fontSize: 11, color: PALETTE.textMuted, flexShrink: 0 }} title="핀에 어떤 가격을 적을지 골라요. 34평은 공급 33~35평(전용 약 84㎡) 거래만 봐요.">핀</span>
                    {PIN_PRICE_MODES.map(([k, l]) => (
                      <button key={`p${k}`} onClick={() => choosePinPriceMode(k)} style={chipStyle(pinPriceMode === k)}>{l}</button>
                    ))}
                    <span style={{ width: 1, height: 18, background: PALETTE.border, flexShrink: 0 }} />
                  </>
                )}
                {!isRone && !isRatio && setUnitSizeFilter && [['all', '전 평형'], ['u20', '~20평'], ['20s', '20평대'], ['30s', '30평대'], ['40s', '40평대'], ['50p', '50평+']].map(([k, l]) => (
                  <button key={`u${k}`} onClick={() => setUnitSizeFilter(k)} style={chipStyle(unitSizeFilter === k)}>{l}</button>
                ))}
                {(dealType === 'trade' || dealType === 'silv') && setBuildYearFilter && (
                  <>
                    <span style={{ width: 1, height: 18, background: PALETTE.border, flexShrink: 0 }} />
                    {[['all', '전체 연식'], ['5', '5년 이내'], ['10', '10년 이내'], ['15', '15년 이내'], ['20', '20년 이내'], ['20p', '20년 초과']].map(([k, l]) => (
                      <button key={`y${k}`} onClick={() => setBuildYearFilter(k)} style={chipStyle(buildYearFilter === k)}>{l}</button>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 부동산 타임머신: 조회 기간 안에서 특정 월로 되돌려서 그 시점의 가격 색칠을 본다 */}
        {!isRone && !isRatio && !budgetMatches && months.length > 1 && (
          <div className="map-timeline" style={{
            // 펼친 단지 목록(오른쪽, 바닥까지)과 겹치지 않게 그 폭만큼 비켜선다(v187). 폰은 page.jsx CSS가 위치를 정한다.
            position: 'absolute', bottom: 14, left: 14, zIndex: 20,
            right: 14 + (selectedApt ? detailInset : (allTx.length > 0 && !mapPanelMinimized ? (compact ? 260 : 292) + 10 : 0)),
            display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'auto',
            background: 'rgba(255,255,255,0.96)', border: `1px solid ${PALETTE.border}`,
            borderRadius: 12, padding: '8px 14px', boxShadow: '0 4px 18px rgba(0,0,0,0.10)',
            backdropFilter: 'blur(8px)', transition: 'right 0.15s ease',
          }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>🕰️ 타임머신</span>
            <input
              type="range"
              min={0}
              max={months.length - 1}
              step={1}
              value={timelineMonth ? months.indexOf(timelineMonth) : months.length - 1}
              onChange={(e) => {
                const idx = parseInt(e.target.value, 10);
                setTimelineMonth(idx === months.length - 1 ? null : months[idx]);
              }}
              style={{ flex: 1, minWidth: 80 }}
            />
            <span style={{ fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap', minWidth: 60, textAlign: 'right' }}>
              {monthLabel(timelineMonth || months[months.length - 1])}{!timelineMonth && ' (최신)'}
            </span>
          </div>
        )}

        {/* 처음 온 사람(지역 0개)에게 무엇을 해야 하는지 알려준다. 예전엔 빈 지도만 보여서, 구를 누르면 된다는 걸 알 수 없었다. */}
        {selected.length === 0 && allTx.length === 0 && !mapError && (
          <div className="map-empty-guide" style={{
            position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 21,
            width: 'min(340px, calc(100% - 32px))', boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.97)', border: `1px solid ${PALETTE.border}`, borderRadius: 14,
            boxShadow: '0 8px 28px rgba(0,0,0,0.14)', padding: '16px 16px 14px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>어디 시세를 볼까요?</div>
            <div style={{ fontSize: 12, color: PALETTE.textMuted, lineHeight: 1.5, marginBottom: 12 }}>
              지도에서 구를 누르거나, 위 검색창에 "해운대 84 8억 이하"처럼 적어보세요.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
              {[['11680', '강남구'], ['11650', '서초구'], ['11710', '송파구'], ['11440', '마포구'],
                ['11200', '성동구'], ['41135', '분당구'], ['41117', '수원 영통'], ['26350', '해운대구']].map(([code, label]) => (
                <button key={code} onClick={() => addRegionAndFetch(code)} style={{
                  border: `1px solid ${PALETTE.border}`, background: PALETTE.panel, borderRadius: 999,
                  padding: '7px 12px', fontSize: 12.5, cursor: 'pointer', color: PALETTE.textPrimary,
                }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 지도 위 단지 탐색 패널: 실거래가가 있는 단지를 바로 선택 */}
        {/* 단지 상세 패널이 오른쪽에 떠 있을 때는 겹치지 않게 숨긴다. */}
        {allTx.length > 0 && !selectedApt && (
          <div className={`map-complex-panel${mapPanelMinimized ? ' is-min' : ''}`} style={{
            // 도구줄(카드 포함) 바로 아래. 아직 못 쟀거나 한 줄뿐이면 예전 값(72)을 유지한다.
            position: 'absolute', top: Math.max(72, 14 + topRowH + 8), right: 14, width: compact ? 260 : 292, zIndex: 19,
            bottom: mapPanelMinimized ? 'auto' : 18,
            background: 'rgba(255,255,255,0.97)', border: `1px solid ${PALETTE.border}`,
            borderRadius: 14, boxShadow: '0 8px 28px rgba(0,0,0,0.12)', overflow: 'hidden',
            backdropFilter: 'blur(10px)',
          }}
          >
            <div
              style={{
                padding: '14px 14px 10px', borderBottom: mapPanelMinimized ? 'none' : `1px solid ${PALETTE.border}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', cursor: 'pointer',
              }}
              onClick={() => setMapPanelMinimized((v) => !v)}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 800 }}>
                  단지 탐색
                  {mapPanelMinimized && (
                    <span style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 600, color: PALETTE.textMuted }}>
                      {(mapPanelList.total ?? complexCompare.length).toLocaleString()}개{locOn ? ` · ${locLabel}` : ''}
                    </span>
                  )}
                </div>
                {!mapPanelMinimized && (
                  <div style={{ fontSize: 11, color: PALETTE.textMuted, marginTop: 3 }}>
                    최근 거래가 있는 단지를 선택하면 상세정보를 확인할 수 있어요.
                  </div>
                )}
              </div>
              {/* 화살표만으로는 누르는 곳인지 알기 어려워서 글자로 보여준다(v186). */}
              <span style={{ fontSize: 11.5, fontWeight: 700, color: PALETTE.accent, flexShrink: 0, marginLeft: 8, whiteSpace: 'nowrap' }}>
                {mapPanelMinimized ? '목록 열기' : '접기'}
              </span>
            </div>
            {!mapPanelMinimized && (
              <div style={{ display: 'flex', borderBottom: `1px solid ${PALETTE.border}` }}>
                {[['complexes', '단지'], ['trades', '최근 거래·신고가'], ...(dealType === 'trade' ? [['gap', '34평 갭 순위']] : [])].map(([k, l]) => (
                  <button key={k} onClick={() => setPanelView(k)} style={{
                    flex: 1, border: 'none', background: 'transparent', padding: '8px 0', fontSize: 12.5, cursor: 'pointer',
                    fontWeight: panelView === k ? 800 : 500, color: panelView === k ? PALETTE.accent : PALETTE.textMuted,
                    borderBottom: panelView === k ? `2px solid ${PALETTE.accent}` : '2px solid transparent',
                  }}>{l}</button>
                ))}
              </div>
            )}
            {!mapPanelMinimized && (
            <div style={{ overflowY: 'auto', height: 'calc(100% - 98px)' }}>
              {panelView === 'trades' ? (
                <RecentTradesFeed
                  codes={selected}
                  isTrade={dealType === 'trade'}
                  onPick={(r) => {
                    const coord = mapComplexCoordByKey.get(`${r.regionCode}|${r.dong}|${r.apt}`) || codeToLatLng[r.regionCode];
                    setSelectedApt({ apt: r.apt, dong: r.dong, regionCode: r.regionCode, lat: coord?.lat, lng: coord?.lng });
                    if (coord) setFocusLatLng(coord);
                  }}
                />
              ) : panelView === 'gap' ? (
                <>
                  <div style={{ padding: '8px 14px', borderBottom: `1px solid ${PALETTE.border}`, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {[
                      ['준공', gapAge, setGapAge, [['all', '전체'], ['10', '10년 이내'], ['15', '15년 이내'], ['20', '20년 이내']]],
                      ['34평 매매', gapMinN, setGapMinN, [[2, '2건+'], [5, '5건+'], [10, '10건+']]],
                      ['역 거리', gapStation, setGapStation, [['all', '전체'], ['500', '500m 이내'], ['1000', '1km 이내']]],
                      ['초등학교', gapSchool, setGapSchool, [['all', '전체'], ['300', '300m 이내'], ['500', '500m 이내']]],
                      ['세대수', gapHH, setGapHH, [['all', '전체'], ['300', '300+'], ['500', '500+'], ['1000', '1000+']]],
                    ].map(([label, val, set, opts]) => (
                      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10.5, color: PALETTE.textMuted, width: 52, flexShrink: 0 }}>{label}</span>
                        {opts.map(([k, l]) => (
                          <button key={k} onClick={() => set(k)} style={{ ...chipStyle(val === k), padding: '3px 8px', fontSize: 10.5 }}>{l}</button>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: '8px 14px', fontSize: 10.5, color: PALETTE.textMuted, borderBottom: `1px solid ${PALETTE.border}`, lineHeight: 1.5 }}>
                    {!gapRows
                      ? '34평 매매·전세 거래를 불러오는 중…'
                      : `조회 지역·기간의 34평(전용 약 84㎡) 갭이 작은 순 ${gapRows.length}개 단지예요${gapRows.length < complexGapList.length ? `(조건 전 ${complexGapList.length}개)` : ''}${gapRows.length > 60 ? ' · 60개까지 표시' : ''}. 갭 = 매매 중간값 − 전세 중간값, 매매·전세 각 2건 이상인 단지만.${gapSchool !== 'all' && !elemSchools ? ' (학교 위치 불러오는 중…)' : ''}${gapHH !== 'all' && hhData && Object.keys(hhData).length === 0 ? ' (세대수 불러오는 중…)' : ''}`}
                  </div>
                  {gapRows && gapRows.length === 0 && (
                    <div style={{ padding: '14px', fontSize: 11.5, color: PALETTE.textMuted }}>조건에 맞는 단지가 없어요. 조건을 넓히거나 기간을 늘려 보세요.</div>
                  )}
                  {(gapRows || []).slice(0, 60).map((g, i) => {
                    const coord = mapComplexCoordByKey.get(g.key) || codeToLatLng[g.regionCode];
                    const gsc = schoolInfoOf ? schoolInfoOf(g.regionCode, g.dong, g.apt) : null; // v214 (학교 위치를 받았을 때만)
                    const ghh = householdsOf ? householdsOf(g.regionCode, g.dong, g.apt) : null; // v214 (세대수를 받았을 때만)
                    return (
                      <button
                        key={g.key}
                        onClick={() => {
                          setSelectedApt({ apt: g.apt, dong: g.dong, regionCode: g.regionCode, lat: coord?.lat, lng: coord?.lng });
                          if (coord) setFocusLatLng(coord);
                        }}
                        style={{ width: '100%', textAlign: 'left', border: 'none', borderBottom: `1px solid ${PALETTE.border}`, background: 'transparent', padding: '10px 14px', cursor: 'pointer' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i + 1}. {g.apt}</div>
                            <div style={{ fontSize: 10.5, color: PALETTE.textMuted, marginTop: 3 }}>{regionLabel(g.regionCode)} {g.dong}{g.buildYear ? ` · ${g.buildYear}년` : ''} · 매매 {g.nSale}·전세 {g.nJeonse}건{ghh ? ` · ${ghh.toLocaleString()}세대` : ''}</div>
                            {g.stationName && (
                              <div style={{ fontSize: 10.5, color: PALETTE.textSecondary, marginTop: 2 }} title="가장 가까운 지하철역까지 직선거리예요(걷는 길은 더 길 수 있어요).">
                                🚇 {g.stationName.endsWith('역') ? g.stationName : `${g.stationName}역`} {g.stationM.toLocaleString()}m{g.stationExact ? '' : ' (동 중심 기준)'}
                              </div>
                            )}
                            {gsc && (
                              <div style={{ fontSize: 10.5, color: PALETTE.textSecondary, marginTop: 2 }} title="가장 가까운 초등학교까지 직선거리예요(학구·통학로는 다를 수 있어요).">
                                🏫 {gsc.name} {gsc.m.toLocaleString()}m{gsc.exact ? '' : ' (동 중심 기준)'}
                              </div>
                            )}
                          </div>
                          <div style={{ flexShrink: 0, textAlign: 'right' }}>
                            <div style={{ fontSize: 12.5, fontWeight: 800 }}>갭 {fmtWon(g.gap)}</div>
                            <div style={{ fontSize: 10, color: PALETTE.textSecondary, marginTop: 2 }}>매매 {fmtWon(g.sale)} · 전세 {fmtWon(g.jeonse)}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </>
              ) : (<>
              {setListStation && (
                <div style={{ padding: '6px 14px', borderBottom: `1px solid ${PALETTE.border}`, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10.5, color: PALETTE.textMuted, width: 52, flexShrink: 0 }}>역 거리</span>
                  {[['all', '전체'], ['500', '500m 이내'], ['1000', '1km 이내']].map(([k, l]) => (
                    <button key={k} onClick={() => setListStation(k)} style={{ ...chipStyle(listStation === k), padding: '3px 8px', fontSize: 10.5 }}>{l}</button>
                  ))}
                </div>
              )}
              {setListSchool && (
                <div style={{ padding: '6px 14px', borderBottom: `1px solid ${PALETTE.border}`, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10.5, color: PALETTE.textMuted, width: 52, flexShrink: 0 }}>초등학교</span>
                  {[['all', '전체'], ['300', '300m 이내'], ['500', '500m 이내']].map(([k, l]) => (
                    <button key={k} onClick={() => setListSchool(k)} style={{ ...chipStyle(listSchool === k), padding: '3px 8px', fontSize: 10.5 }}>{l}</button>
                  ))}
                  {listSchool !== 'all' && !elemSchools && <span style={{ fontSize: 10, color: PALETTE.textMuted }}>학교 위치 불러오는 중…</span>}
                </div>
              )}
              {setListHH && (
                <div style={{ padding: '6px 14px', borderBottom: `1px solid ${PALETTE.border}`, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10.5, color: PALETTE.textMuted, width: 52, flexShrink: 0 }}>세대수</span>
                  {[['all', '전체'], ['300', '300+'], ['500', '500+'], ['1000', '1000+']].map(([k, l]) => (
                    <button key={k} onClick={() => setListHH(k)} style={{ ...chipStyle(listHH === k), padding: '3px 8px', fontSize: 10.5 }}>{l}</button>
                  ))}
                  {listHH !== 'all' && hhData && Object.keys(hhData).length === 0 && <span style={{ fontSize: 10, color: PALETTE.textMuted }}>세대수 불러오는 중…</span>}
                </div>
              )}
              {kwRows && (
                <div style={{ padding: '8px 14px', fontSize: 10.5, color: PALETTE.textMuted, borderBottom: `1px solid ${PALETTE.border}`, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>"{mapKeyword.trim()}" 검색 결과 {kwRows.length}개{kwRows.length > 60 ? ' (60개까지 표시)' : ''}</span>
                  <span style={{ cursor: 'pointer', color: PALETTE.accent, textDecoration: 'underline', flexShrink: 0 }} onClick={() => setMapKeyword('')}>검색 지우기</span>
                </div>
              )}
              {!kwRows && clusterRows && (
                <div style={{ padding: '8px 14px', fontSize: 10.5, color: PALETTE.textMuted, borderBottom: `1px solid ${PALETTE.border}`, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>누른 묶음의 단지 {clusterRows.length}개{locOn ? ` · ${locLabel} ${clusterRows.filter(nearStation).length}개` : ''}</span>
                  <span style={{ cursor: 'pointer', color: PALETTE.accent, textDecoration: 'underline', flexShrink: 0 }} onClick={() => setClusterKeys(null)}>전체 보기</span>
                </div>
              )}
              {!kwRows && !clusterRows && budgetMatches && (
                // 예산 필터가 켜져 있으면 목록이 그 조건으로 걸러진다는 걸 머리글로 알려주고, 바로 끌 수 있게 한다.
                // (0개일 때 아무 설명이 없으면 "고장 났다"로 보이기 쉽다 — 예: 이전 검색의 "8억 이하"가 남아 있는 경우)
                <div data-budget-header="1" style={{ padding: '8px 14px', fontSize: 10.5, color: PALETTE.textMuted, borderBottom: `1px solid ${PALETTE.border}`, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>
                    {budgetMatches.length === 0
                      ? `예산 ${budgetAmount}억 이하인 단지가 없어요`
                      : `예산 ${budgetAmount}억 이하 단지 ${budgetMatches.length}개${locOn ? ` · ${locLabel} ${budgetMatches.filter(nearStation).length}개` : ''}`}
                  </span>
                  <span
                    data-budget-clear="1"
                    style={{ cursor: 'pointer', color: PALETTE.accent, textDecoration: 'underline', flexShrink: 0 }}
                    onClick={() => { setBudgetAmount(''); setBudgetSearchOpen(false); }}
                  >
                    예산 조건 해제
                  </span>
                </div>
              )}
              {!kwRows && !clusterRows && !budgetMatches && mapViewportBounds && (
                <div style={{ padding: '8px 14px', fontSize: 10.5, color: PALETTE.textMuted, borderBottom: `1px solid ${PALETTE.border}` }}>
                  현재 화면의 거래 있는 단지{locOn ? `(${locLabel})` : ''} {mapPanelList.total ?? mapPanelList.length}개{(mapPanelList.total ?? 0) > mapPanelList.length ? ` (${mapPanelList.length}개까지 표시)` : ''}
                </div>
              )}
              {(kwRows ? kwRows.slice(0, 60) : (clusterRows || budgetMatches)?.filter(nearStation) || mapPanelList).map((c, i) => {
                const coord = mapComplexCoordByKey.get(`${c.regionCode}|${c.dong}|${c.apt}`) || codeToLatLng[c.regionCode];
                const priceVal = c.latestPrice ?? (isRent ? c.deposit : c.amount);
                const areaVal = c.latestArea ?? c.area;
                // 평당가·신축·등락률(v182). 묶음/예산 목록 행에는 준공연도·등락률이 없어서 있는 것만 보인다.
                const ppp = c.unitPrice ?? c.latestPyeong;
                const built = Number(c.buildYear);
                const isNew = built > 0 && new Date().getFullYear() - built <= 5;
                const showChange = c.change != null && c.count >= 2;
                const st = stationInfoOf ? stationInfoOf(c.regionCode, c.dong, c.apt) : null; // v207
                const sc = schoolInfoOf ? schoolInfoOf(c.regionCode, c.dong, c.apt) : null; // v211 (학교 위치를 받았을 때만)
                const hh = householdsOf ? householdsOf(c.regionCode, c.dong, c.apt) : null; // v212 (세대수를 받았을 때만)
                return (
                  <button
                    key={`${c.regionCode}|${c.dong}|${c.apt}|${i}`}
                    onClick={() => {
                      setSelectedApt({ apt: c.apt, dong: c.dong, regionCode: c.regionCode, lat: coord?.lat, lng: coord?.lng });
                      if (coord) setFocusLatLng(coord);
                    }}
                    style={{
                      width: '100%', textAlign: 'left', border: 'none', borderBottom: `1px solid ${PALETTE.border}`,
                      background: 'transparent', padding: '11px 14px', cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.apt}</span>
                          {isNew && <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 800, color: PALETTE.accent, background: '#FDECEC', borderRadius: 4, padding: '1px 4px' }}>신축</span>}
                        </div>
                        <div style={{ fontSize: 10.5, color: PALETTE.textMuted, marginTop: 3 }}>{regionLabel(c.regionCode)} {c.dong}{built > 0 ? ` · ${built}년` : ''}{c.count != null ? ` · ${c.count}건` : ''}{hh ? ` · ${hh.toLocaleString()}세대` : ''}</div>
                        {st && (
                          <div style={{ fontSize: 10.5, color: PALETTE.textSecondary, marginTop: 2 }} title="가장 가까운 지하철역까지 직선거리예요(걷는 길은 더 길 수 있어요).">
                            🚇 {st.name.endsWith('역') ? st.name : `${st.name}역`} {st.m.toLocaleString()}m{st.exact ? '' : ' (동 중심 기준)'}
                          </div>
                        )}
                        {sc && (
                          <div style={{ fontSize: 10.5, color: PALETTE.textSecondary, marginTop: 2 }} title="가장 가까운 초등학교까지 직선거리예요(학구·통학로는 다를 수 있어요).">
                            🏫 {sc.name} {sc.m.toLocaleString()}m{sc.exact ? '' : ' (동 중심 기준)'}
                          </div>
                        )}
                      </div>
                      <div style={{ flexShrink: 0, textAlign: 'right' }}>
                        <div style={{ fontSize: 12.5, fontWeight: 800 }}>{priceVal != null ? fmtWon(priceVal) : '-'}</div>
                        {ppp != null && <div style={{ fontSize: 10, color: PALETTE.textSecondary, marginTop: 2 }}>평당 {fmtWon(ppp)}</div>}
                        <div style={{ fontSize: 10, color: PALETTE.textMuted, marginTop: 2 }}>
                          {areaVal != null ? fmtArea(areaVal) : ''}
                          {showChange && <span style={{ marginLeft: 4, fontWeight: 700, color: c.change > 0 ? PALETTE.up : c.change < 0 ? PALETTE.down : PALETTE.textMuted }}>{fmtPct(c.change)}</span>}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
              </>)}
            </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

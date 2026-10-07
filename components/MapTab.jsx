import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import NaverChoropleth from './NaverChoropleth';
import KakaoChoropleth from './KakaoChoropleth';
import PinnedCompareDrawer from './PinnedCompareDrawer';
import { classifyListOnly } from '../lib/complex-match';
import { regionLabel } from '../lib/regions';
import { PALETTE, fmtWon, fmtArea, monthLabel, APP_BUILD } from '../lib/ui-helpers';
import { pinnedKeyOf } from '../lib/compare-grid';
import { changeCap, changeColor, formatChange } from '../lib/market-change';

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
}) {
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);
  const [listOnlyOpen, setListOnlyOpen] = useState(false);
  // 숫자 원을 눌러도 확대로 갈라지지 않을 때(같은 위치·최대 줌) 그 안의 단지 목록을 오른쪽 패널에 보여준다.
  const [clusterKeys, setClusterKeys] = useState(null); // Set<string> | null
  const clusterRows = useMemo(() => {
    if (!clusterKeys) return null;
    const rows = mapComplexes.filter((c) => clusterKeys.has(c.key));
    return rows.length ? rows : null;
  }, [clusterKeys, mapComplexes]);
  // "목록만" 진단은 펼쳤을 때만 계산한다 (단지가 수백 개라 평소엔 돌릴 필요가 없다).
  const listOnlyReport = useMemo(
    () => (listOnlyOpen ? classifyListOnly(mapComplexes) : null),
    [listOnlyOpen, mapComplexes],
  );

  // 비교함에 담은 단지 키(지도에서 ★로 강조). pinnedComplexes가 바뀔 때만 새 Set을 만들어 지도가 불필요하게 다시 그려지지 않게 한다.
  const pinnedKeys = useMemo(() => new Set((pinnedComplexes || []).map(pinnedKeyOf)), [pinnedComplexes]);
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
  // 좁아지는 순간 한 번만 목록을 접는다(사용자가 다시 펼치면 그대로 둔다).
  const autoMinimizedRef = useRef(false);
  useEffect(() => {
    if (compact && !autoMinimizedRef.current && typeof window !== 'undefined' && window.innerWidth > 720) {
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
            valueFormat={mapColorMode === 'change' || mapColorMode === 'volchange' ? formatChange : undefined}
            valueNotes={seoulMapData.notes}
            dongValueNotes={dongMapData?.notes}
            borderColor={PALETTE.border}
            onSelect={(code) => addRegionAndFetch(code)}
            focusLatLng={focusLatLng}
            complexes={mapFocusMatches || budgetMatches || priceMoveMatches || mapComplexes}
            onComplexSelect={(c) => setSelectedApt({ apt: c.apt, dong: c.dong, regionCode: c.regionCode, lat: c.lat, lng: c.lng })}
            dongFeatures={dongMapData?.features}
            dongValues={dongMapData?.values}
            onZoomTierChange={setMapZoomTier}
            onViewportChange={setMapViewportBounds}
            onVisibleMarkerCount={setVisibleMarkerCount}
            onGeocodeStats={setGeocodeStats}
            onClusterOpen={(keys) => { setClusterKeys(new Set(keys)); setMapPanelMinimized(false); }}
            pinnedKeys={pinnedKeys}
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
            complexes={mapFocusMatches || budgetMatches || priceMoveMatches || mapComplexes}
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
                      {[['price', '가격'], ['volume', '거래량'], ['change', '가격변동'], ['volchange', '거래량변동']].map(([key, label]) => (
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
        </div>

        {/* 부동산 타임머신: 조회 기간 안에서 특정 월로 되돌려서 그 시점의 가격 색칠을 본다 */}
        {!isRone && !isRatio && !budgetMatches && months.length > 1 && (
          <div className="map-timeline" style={{
            position: 'absolute', bottom: 14, left: 14, right: 14 + (selectedApt ? detailInset : 0), zIndex: 20,
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
                <div style={{ fontSize: 14, fontWeight: 800 }}>단지 탐색</div>
                {!mapPanelMinimized && (
                  <div style={{ fontSize: 11, color: PALETTE.textMuted, marginTop: 3 }}>
                    최근 거래가 있는 단지를 선택하면 상세정보를 확인할 수 있어요.
                  </div>
                )}
              </div>
              <span style={{ fontSize: 16, color: PALETTE.textMuted, lineHeight: 1, flexShrink: 0, marginLeft: 8 }}>
                {mapPanelMinimized ? '▸' : '▾'}
              </span>
            </div>
            {!mapPanelMinimized && (
            <div style={{ overflowY: 'auto', height: 'calc(100% - 64px)' }}>
              {clusterRows && (
                <div style={{ padding: '8px 14px', fontSize: 10.5, color: PALETTE.textMuted, borderBottom: `1px solid ${PALETTE.border}`, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>같은 위치에 겹쳐 있는 단지 {clusterRows.length}개</span>
                  <span style={{ cursor: 'pointer', color: PALETTE.accent, textDecoration: 'underline', flexShrink: 0 }} onClick={() => setClusterKeys(null)}>전체 보기</span>
                </div>
              )}
              {!clusterRows && budgetMatches && (
                // 예산 필터가 켜져 있으면 목록이 그 조건으로 걸러진다는 걸 머리글로 알려주고, 바로 끌 수 있게 한다.
                // (0개일 때 아무 설명이 없으면 "고장 났다"로 보이기 쉽다 — 예: 이전 검색의 "8억 이하"가 남아 있는 경우)
                <div data-budget-header="1" style={{ padding: '8px 14px', fontSize: 10.5, color: PALETTE.textMuted, borderBottom: `1px solid ${PALETTE.border}`, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>
                    {budgetMatches.length === 0
                      ? `예산 ${budgetAmount}억 이하인 단지가 없어요`
                      : `예산 ${budgetAmount}억 이하 단지 ${budgetMatches.length}개`}
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
              {!clusterRows && !budgetMatches && mapViewportBounds && (
                <div style={{ padding: '8px 14px', fontSize: 10.5, color: PALETTE.textMuted, borderBottom: `1px solid ${PALETTE.border}` }}>
                  현재 화면에 보이는 단지 {mapPanelList.length}개
                </div>
              )}
              {(clusterRows || budgetMatches || mapPanelList).map((c, i) => {
                const coord = mapComplexCoordByKey.get(`${c.regionCode}|${c.dong}|${c.apt}`) || codeToLatLng[c.regionCode];
                const priceVal = c.latestPrice ?? (isRent ? c.deposit : c.amount);
                const areaVal = c.latestArea ?? c.area;
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
                        <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.apt}</div>
                        <div style={{ fontSize: 10.5, color: PALETTE.textMuted, marginTop: 3 }}>{regionLabel(c.regionCode)} {c.dong}{c.count != null ? ` · ${c.count}건` : ''}</div>
                      </div>
                      <div style={{ flexShrink: 0, textAlign: 'right' }}>
                        <div style={{ fontSize: 12.5, fontWeight: 800 }}>{priceVal != null ? fmtWon(priceVal) : '-'}</div>
                        <div style={{ fontSize: 10, color: PALETTE.textMuted, marginTop: 3 }}>{areaVal != null ? fmtArea(areaVal) : ''}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

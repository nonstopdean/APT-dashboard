import React from 'react';
import { ChevronRight } from 'lucide-react';
import NaverChoropleth from './NaverChoropleth';
import KakaoChoropleth from './KakaoChoropleth';
import { regionLabel } from '../lib/regions';
import { PALETTE, fmtWon, fmtArea, monthLabel } from '../lib/ui-helpers';

// 지도 탭 전체(왼쪽 패널 + 지도 + 툴바 + 단지 탐색 패널). app/page.jsx 안에 있던
// viewMode === 'map' 블록과 renderSeoulMap()을 그대로 옮긴 것으로, 로직은 바꾸지 않았다.
export default function MapTab({
  selectedApt,
  panelOpen, setPanelOpen, sidebarInner, styles,
  mapError, seoulMapData, addRegionAndFetch, focusLatLng,
  mapFocusMatches, budgetMatches, priceMoveMatches, mapComplexes,
  setSelectedApt, dongMapData, setMapZoomTier, setMapViewportBounds, setVisibleMarkerCount, visibleStations,
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
    const colorFor = (value) => {
      if (value == null) return PALETTE.panelAlt;
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
            stations={visibleStations}
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
      ) : (
        <button
          onClick={() => setPanelOpen(true)}
          style={{
            width: 28, flexShrink: 0, height: '100%', border: 'none', borderRight: `1px solid ${PALETTE.border}`,
            background: PALETTE.panel, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-label="패널 펼치기"
        >
          <ChevronRight size={16} color={PALETTE.textMuted} />
        </button>
      )}

      <div style={{ position: 'relative', flex: 1, touchAction: 'none', minWidth: 0 }}>
        {renderSeoulMap()}

        {/* 지도 위 탐색 도구: 거래유형을 사이드바로 안 가고 바로 바꿀 수 있게 */}
        <div className="map-portal-toolbar" style={{
          position: 'absolute', top: 14, left: 14, right: selectedApt ? 434 : 14, zIndex: 20,
          display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none', transition: 'right 0.15s ease',
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
          {!isRone && !isRatio && (
            <div style={{
              pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 4,
              background: 'rgba(255,255,255,0.96)', border: `1px solid ${PALETTE.border}`,
              borderRadius: 12, padding: 5, boxShadow: '0 4px 18px rgba(0,0,0,0.10)',
              backdropFilter: 'blur(8px)',
            }}
            >
              {[['price', '가격'], ['volume', '거래량']].map(([key, label]) => (
                <button key={key} className="portal-pill" onClick={() => setMapColorMode(key)} style={{
                  border: 'none', borderRadius: 9, padding: '8px 12px', whiteSpace: 'nowrap',
                  background: mapColorMode === key ? PALETTE.textPrimary : 'transparent',
                  color: mapColorMode === key ? '#fff' : PALETTE.textSecondary,
                  fontSize: 12, fontWeight: mapColorMode === key ? 700 : 500, cursor: 'pointer',
                }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
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
          <button
            className="portal-pill"
            onClick={() => setDongLayerOn((v) => !v)}
            style={{
              pointerEvents: 'auto', border: `1px solid ${PALETTE.border}`, borderRadius: 12,
              padding: '9px 12px', background: 'rgba(255,255,255,0.96)', boxShadow: '0 4px 18px rgba(0,0,0,0.10)',
              fontSize: 12, fontWeight: dongLayerOn ? 500 : 700,
              color: dongLayerOn ? PALETTE.textSecondary : PALETTE.accent, whiteSpace: 'nowrap',
            }}
            title="끄면 동 경계·색칠을 아예 안 그려서 단지 마커 표시에 더 집중해요"
          >
            {dongLayerOn ? '🗺️ 동 색칠 켜짐' : '⚡ 동 색칠 끔 (가벼운 모드)'}
          </button>
          <button
            className="portal-pill"
            onClick={() => setSubwayLayerOn((v) => !v)}
            style={{
              pointerEvents: 'auto', border: `1px solid ${PALETTE.border}`, borderRadius: 12,
              padding: '9px 12px', background: 'rgba(255,255,255,0.96)', boxShadow: '0 4px 18px rgba(0,0,0,0.10)',
              fontSize: 12, fontWeight: subwayLayerOn ? 700 : 500,
              color: subwayLayerOn ? PALETTE.accent : PALETTE.textSecondary, whiteSpace: 'nowrap',
            }}
            title="화면에 보이는 범위의 지하철역을 지도에 표시해요"
          >
            🚇 지하철역{subwayLayerOn ? ' 켜짐' : ''}
          </button>
          {!isRent && !isRatio && !isRone && (
            <div style={{
              pointerEvents: 'auto', display: 'flex', gap: 2,
              background: 'rgba(255,255,255,0.96)', border: `1px solid ${PALETTE.border}`,
              borderRadius: 12, padding: 4, boxShadow: '0 4px 18px rgba(0,0,0,0.10)',
            }}
            >
              {[['all', '전체'], ['high', '📈 신고가'], ['drop', '📉 하락']].map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setPriceMoveFilter(k)}
                  style={{
                    border: 'none', borderRadius: 9, padding: '6px 9px', whiteSpace: 'nowrap',
                    background: priceMoveFilter === k ? PALETTE.textPrimary : 'transparent',
                    color: priceMoveFilter === k ? '#fff' : PALETTE.textSecondary,
                    fontSize: 11.5, fontWeight: priceMoveFilter === k ? 700 : 500, cursor: 'pointer',
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
          )}
          <div className="map-status-card" style={{
            marginLeft: 'auto', pointerEvents: 'auto', background: 'rgba(255,255,255,0.96)',
            border: `1px solid ${PALETTE.border}`, borderRadius: 12, padding: '9px 12px',
            boxShadow: '0 4px 18px rgba(0,0,0,0.10)', fontSize: 11.5, whiteSpace: 'nowrap',
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
                {mapComplexes.length > 0 && (
                  <div style={{ fontSize: 10, color: PALETTE.textMuted, marginTop: 2 }}>
                    단지 {mapComplexes.length}개 중 좌표확보 {mapComplexes.filter((c) => c.lat != null).length}개
                    {visibleMarkerCount != null && ` · 화면표시 ${visibleMarkerCount}개`}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* 부동산 타임머신: 조회 기간 안에서 특정 월로 되돌려서 그 시점의 가격 색칠을 본다 */}
        {!isRone && !isRatio && !budgetMatches && months.length > 1 && (
          <div style={{
            position: 'absolute', bottom: 14, left: 14, right: selectedApt ? 434 : 14, zIndex: 20,
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

        {/* 지도 위 단지 탐색 패널: 실거래가가 있는 단지를 바로 선택 */}
        {/* 단지 상세 패널이 오른쪽에 떠 있을 때는 겹치지 않게 숨긴다. */}
        {allTx.length > 0 && !selectedApt && (
          <div className="map-complex-panel" style={{
            position: 'absolute', top: 72, right: 14, width: 292, zIndex: 19,
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
              {!budgetMatches && mapViewportBounds && (
                <div style={{ padding: '8px 14px', fontSize: 10.5, color: PALETTE.textMuted, borderBottom: `1px solid ${PALETTE.border}` }}>
                  현재 화면에 보이는 단지 {mapPanelList.length}개
                </div>
              )}
              {(budgetMatches || mapPanelList).map((c, i) => {
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

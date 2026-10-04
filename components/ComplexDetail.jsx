import React from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { X } from 'lucide-react';
import { isRegulatedByCode } from '../lib/regions';
import {
  PALETTE, LINE_COLORS, fmtPct, fmtArea, fmtManwon, calcAcquisitionTax, calcLoanEstimate, labelFor, slopeClass,
} from '../lib/ui-helpers';
import FloatingWindow from './FloatingWindow';

// 단지 상세. app/page.jsx 안에 있던 ~600줄짜리 JSX를 그대로 옮긴 것으로, 로직은 바꾸지 않았다.
// selectedApt가 있을 때만 부모(page.jsx)가 이 컴포넌트를 렌더링한다.
// variant="panel"이면(지도 탭) 화면을 가리는 모달 대신, 지도는 계속 보이게 오른쪽에 붙는
// 패널로 뜬다. 그 외 탭에서는 기존처럼 가운데 모달로 뜬다.
export default function ComplexDetail({
  variant = 'modal',
  selectedApt, setSelectedApt,
  aptHistory, aptHistoryLoading, aptHistoryFullRange, aptHistoryFiltered, aptHistoryAreaOptions, loadFullAptHistory,
  aptSummary, aptTrendData, aptTrendByArea, aptVolumeData,
  isRent, isRatio, isRone,
  calcPriceInput, setCalcPriceInput,
  tradeUpCurrentPrice, setTradeUpCurrentPrice, tradeUpLoanBalance, setTradeUpLoanBalance,
  tradeUpTargetPrice, setTradeUpTargetPrice,
  terrainInfo, terrainLoading, winterSun,
  poiInfo, poiLoading,
  gongsiInfo, gongsiLoading,
  aptBasicInfo, nearestStationInfo, nearbySchools, schoolsLoading,
  nearbyRadius, setNearbyRadius, nearbyComplexes, radiusSummary,
  similarComplexes,
  pinnedComplexes, setPinnedComplexes,
  setMapFocusKeys, setViewMode,
  aptJeonseInfo,
  alertFormOpen, setAlertFormOpen, alertDirection, setAlertDirection,
  alertTargetPrice, setAlertTargetPrice, alertSaving, submitAlert,
  historyAreaFilter, setHistoryAreaFilter, historyListLimit, setHistoryListLimit,
  trendViewMode, setTrendViewMode,
  styles,
  onPanelInsetChange,
}) {
  const isPanel = variant === 'panel';
  // 본문은 한 글자도 바꾸지 않고 변수로 빼서, 패널(지도 탭)일 때는 떠 있는 창으로, 모달일 때는 기존 모양 그대로 감싼다.
  const detailBody = (
    <>
        <p style={{ fontSize: 12, color: PALETTE.textMuted, margin: '0 0 14px' }}>
          {labelFor(selectedApt.regionCode)} · 전체 기간(최대 20년) 실거래 내역 {aptHistoryLoading ? '불러오는 중...' : `${aptHistory.length}건`}
          {isRatio || isRone ? '' : ` (${isRent ? '전월세' : '매매'} 기준)`}
        </p>
        {aptSummary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 14 }}>
            <div style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: '8px 10px' }}>
              <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>최근 3개월 평균</div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{aptSummary.recentAvg != null ? fmtManwon(aptSummary.recentAvg) : '-'}</div>
              <div style={{ fontSize: 10, color: PALETTE.textMuted }}>거래 {aptSummary.recentCount}건</div>
            </div>
            <div style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: '8px 10px' }} title={`최근 3개월 표본 ${aptSummary.recentSampleN}건, 1년 전 표본 ${aptSummary.yearAgoSampleN}건`}>
              <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>1년 전 대비</div>
              {aptSummary.yoyChange == null ? (
                <div style={{ fontSize: 15, fontWeight: 800, color: PALETTE.textMuted }}>-</div>
              ) : aptSummary.yoyLowSample ? (
                <div style={{ fontSize: 13, fontWeight: 700, color: PALETTE.textMuted }}>표본 부족</div>
              ) : (
                <div style={{ fontSize: 15, fontWeight: 800, color: aptSummary.yoyChange > 0 ? PALETTE.up : aptSummary.yoyChange < 0 ? PALETTE.down : PALETTE.textPrimary }}>
                  {fmtPct(aptSummary.yoyChange)}
                </div>
              )}
              <div style={{ fontSize: 10, color: PALETTE.textMuted }}>
                {aptSummary.yearAgoAvg != null
                  ? `1년 전 평균 ${fmtManwon(aptSummary.yearAgoAvg)}${aptSummary.yoyLowSample ? ` (표본 ${aptSummary.recentSampleN}·${aptSummary.yearAgoSampleN}건)` : ''}`
                  : '비교 기준 없음'}
              </div>
            </div>
            <div style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: '8px 10px' }}>
              <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>{aptHistoryFullRange ? '전체기간 최고가' : '최근 3년 최고가'}</div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{aptSummary.maxPrice != null ? fmtManwon(aptSummary.maxPrice) : '-'}</div>
              <div style={{ fontSize: 10, color: PALETTE.textMuted }}>{aptSummary.maxLabel}</div>
            </div>
            <div style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: '8px 10px' }} title="최근 12개월 거래건수 ÷ 세대수 × 100. 세대수 대비 거래가 얼마나 활발한지 보는 참고 지표예요.">
              <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>거래회전율(최근 1년)</div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{aptSummary.turnoverRate != null ? `${aptSummary.turnoverRate.toFixed(1)}%` : '-'}</div>
              <div style={{ fontSize: 10, color: PALETTE.textMuted }}>
                {aptSummary.turnoverRate != null ? `거래 ${aptSummary.last12moCount}건 / 세대수 ${aptBasicInfo?.households}` : '세대수 정보 없음'}
              </div>
            </div>
            {aptJeonseInfo && aptSummary.recentAvg != null && (
              <div style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: '8px 10px' }} title="최근 12개월 이 단지 전세 거래 평균 ÷ 최근 3개월 매매 평균 × 100. 표본이 적으면 오차가 클 수 있어요.">
                <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>전세가율(최근 12개월)</div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>{((aptJeonseInfo.avgDeposit / aptSummary.recentAvg) * 100).toFixed(1)}%</div>
                <div style={{ fontSize: 10, color: PALETTE.textMuted }}>
                  전세 {fmtManwon(Math.round(aptJeonseInfo.avgDeposit))} · 표본 {aptJeonseInfo.count}건
                </div>
              </div>
            )}
          </div>
        )}
        {aptSummary && (
          <p style={{ fontSize: 9.5, color: PALETTE.textMuted, margin: '-8px 0 6px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>
              기준일 {new Date().toLocaleDateString('ko-KR')} · 이 단지 거래 표본 {aptHistory.length}건({aptHistoryFullRange ? '최대 20년치' : '최근 3년치'}) · 국토교통부 실거래가 공개자료
            </span>
            {!aptHistoryFullRange && (
              <button
                onClick={loadFullAptHistory}
                disabled={aptHistoryLoading}
                style={{ border: `1px solid ${PALETTE.border}`, borderRadius: 6, padding: '2px 8px', fontSize: 9.5, background: 'transparent', color: PALETTE.accent, cursor: 'pointer' }}
              >
                {aptHistoryLoading ? '불러오는 중...' : '더 오래된 기록 불러오기(최대 20년)'}
              </button>
            )}
          </p>
        )}
        {aptSummary?.volumeChangePct != null && Math.abs(aptSummary.volumeChangePct) >= 20 && (
          <div style={{
            background: aptSummary.volumeChangePct > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(59,111,224,0.08)',
            borderRadius: 8, padding: '9px 12px', marginBottom: 14, fontSize: 12,
          }}
          >
            {aptSummary.volumeChangePct > 0 ? '📈' : '📉'} 최근 3개월 거래 <b>{aptSummary.recentCount}건</b>, 이전 3개월 <b>{aptSummary.prev3moCount}건</b> — 거래량이{' '}
            <b style={{ color: aptSummary.volumeChangePct > 0 ? PALETTE.up : PALETTE.down }}>{fmtPct(aptSummary.volumeChangePct)}</b> 변했어요.
          </div>
        )}
        {!isRent && !isRatio && !isRone && aptSummary?.recentAvg != null && (() => {
          const price = calcPriceInput !== '' ? parseFloat(calcPriceInput) * 10000 : aptSummary.recentAvg;
          const tax = calcAcquisitionTax(price);
          const loan = calcLoanEstimate(price, isRegulatedByCode(selectedApt.regionCode));
          return (
            <div style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: 12, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>취득세·대출 계산기 (참고용)</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="number"
                    placeholder={String(Math.round(aptSummary.recentAvg / 10000))}
                    value={calcPriceInput}
                    onChange={(e) => setCalcPriceInput(e.target.value)}
                    style={{
                      width: 80, padding: '4px 6px', borderRadius: 6, border: `1px solid ${PALETTE.border}`,
                      fontSize: 12, textAlign: 'right',
                    }}
                  />
                  <span style={{ fontSize: 11, color: PALETTE.textMuted }}>억원 기준</span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>취득세 등 합계 (1주택 기준)</div>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>{tax ? fmtManwon(tax.total) : '-'}</div>
                  <div style={{ fontSize: 10, color: PALETTE.textMuted }}>취득세율 약 {tax ? tax.rate.toFixed(2) : '-'}%</div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>추정 대출 가능액 (LTV 기준)</div>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>{loan ? fmtManwon(loan.maxLoan) : '-'}</div>
                  <div style={{ fontSize: 10, color: PALETTE.textMuted }}>LTV {loan ? Math.round(loan.ltv * 100) : '-'}% ({isRegulatedByCode(selectedApt.regionCode) ? '규제지역' : '비규제지역'})</div>
                </div>
              </div>
              <p style={{ fontSize: 9.5, color: PALETTE.textMuted, margin: '8px 0 0' }}>
                다주택 중과·생애최초 감면·DSR·소득 등은 반영되지 않은 단순 참고용 추정치예요. 실제 세액·대출한도는 세무사·은행 확인이 필요해요.
              </p>
            </div>
          );
        })()}
        {gongsiLoading && (
          <p style={{ fontSize: 11, color: PALETTE.textMuted, marginBottom: 10 }}>공시가격 조회 중...</p>
        )}
        {terrainLoading && (
          <p style={{ fontSize: 11, color: PALETTE.textMuted, marginBottom: 10 }}>지형·일조 정보 계산 중...</p>
        )}
        {terrainInfo && winterSun && (
          <div style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: 12, marginBottom: 14 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>⛰️ 경사도 · ☀️ 동지 일조 (참고용 근사치)</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {terrainInfo.center != null && <span style={styles.chip}>중심 고도 약 {Math.round(terrainInfo.center)}m</span>}
              {terrainInfo.slope != null && <span style={styles.chip}>경사 약 {terrainInfo.slope.toFixed(1)}° ({slopeClass(terrainInfo.slope)})</span>}
              {winterSun.facades.map((f) => (
                <span key={f.label} style={styles.chip}>{f.label} {f.hours.toFixed(1)}시간</span>
              ))}
            </div>
            <p style={{ fontSize: 9.5, color: PALETTE.textMuted, margin: '8px 0 0' }}>
              동지(12/21) 기준 일출 {winterSun.sunrise} · 일몰 {winterSun.sunset} · 정오 태양고도 약 {winterSun.noonAlt}°.
              일조시간은 단지 좌표의 천문 계산값이고, 경사도는 중심점에서 동·서·남·북 약 170m 지점 고도(Open-Meteo) 차이로 추정했어요.
              건물 배치·지형 음영은 반영되지 않은 근사치라 실제 일조와 다를 수 있어요.
            </p>
          </div>
        )}
        {poiLoading && (
          <p style={{ fontSize: 11, color: PALETTE.textMuted, marginBottom: 10 }}>주변시설 조회 중...</p>
        )}
        {poiInfo?.results?.length > 0 && (
          <div style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: 12, marginBottom: 14 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>🏪 반경 {poiInfo.radius}m 주변시설</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 8 }}>
              {poiInfo.results.map((r) => (
                <div key={r.code} title={r.sample?.join(', ')} style={{ background: PALETTE.panel, borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>{r.label}</div>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>{r.count != null ? `${r.count}개` : '-'}</div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 9.5, color: PALETTE.textMuted, margin: '8px 0 0' }}>
              단지 좌표 기준 반경 {poiInfo.radius}m 이내 개수예요 (카카오맵 장소 검색). 실제 도보 접근성과는 차이가 있을 수 있어요.
            </p>
          </div>
        )}
        {gongsiInfo?.rows?.length > 0 && (
          <div style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: 12, marginBottom: 14 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>공동주택 공시가격 (브이월드)</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {gongsiInfo.rows.slice(0, 6).map((r, i) => (
                <span key={i} style={styles.chip}>
                  {r.dong}동 {r.ho}호 · {fmtManwon(Math.round(r.price / 10000))} ({r.year}년)
                </span>
              ))}
            </div>
          </div>
        )}
        {!isRent && !isRatio && !isRone && aptSummary?.recentAvg != null && (
          <div style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: 12, marginBottom: 14 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>🔄 갈아타기 계산기 (참고용)</span>
            <p style={{ fontSize: 10.5, color: PALETTE.textMuted, margin: '4px 0 10px' }}>
              목표가는 기본으로 이 단지의 최근 평균가가 들어있지만, 직접 고치면 다른 단지 가격으로도 계산할 수 있어요.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 10.5, color: PALETTE.textMuted }}>현재 집 예상 매도가(억원)</label>
                <input
                  type="number" placeholder="예: 6.5" value={tradeUpCurrentPrice}
                  onChange={(e) => setTradeUpCurrentPrice(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${PALETTE.border}`, fontSize: 12, marginTop: 3 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 10.5, color: PALETTE.textMuted }}>대출 잔액(억원)</label>
                <input
                  type="number" placeholder="예: 2" value={tradeUpLoanBalance}
                  onChange={(e) => setTradeUpLoanBalance(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${PALETTE.border}`, fontSize: 12, marginTop: 3 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 10.5, color: PALETTE.textMuted }}>목표 단지 가격(억원)</label>
                <input
                  type="number" placeholder={(aptSummary.recentAvg / 10000).toFixed(2)} value={tradeUpTargetPrice}
                  onChange={(e) => setTradeUpTargetPrice(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${PALETTE.border}`, fontSize: 12, marginTop: 3 }}
                />
              </div>
            </div>
            {tradeUpCurrentPrice && (() => {
              const targetPrice = tradeUpTargetPrice ? parseFloat(tradeUpTargetPrice) * 10000 : aptSummary.recentAvg; // 만원
              const currentPrice = parseFloat(tradeUpCurrentPrice) * 10000;
              const loanBalance = tradeUpLoanBalance ? parseFloat(tradeUpLoanBalance) * 10000 : 0;
              const sellCost = currentPrice * 0.005; // 중개보수 등 대략 0.5% 참고치
              const targetTax = calcAcquisitionTax(targetPrice);
              const usable = currentPrice - loanBalance - sellCost;
              const needed = targetPrice + (targetTax?.total || 0) - usable;
              return (
                <div style={{ background: PALETTE.panel, borderRadius: 8, padding: 10, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span>현재 집 매도가</span><span>{fmtManwon(currentPrice)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: PALETTE.down }}><span>− 대출 잔액</span><span>{fmtManwon(loanBalance)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: PALETTE.down }}><span>− 매도 중개보수(추정)</span><span>{fmtManwon(sellCost)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: `1px solid ${PALETTE.border}`, fontWeight: 700 }}><span>실제 사용 가능 자금</span><span>{fmtManwon(usable)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', marginTop: 6 }}><span>목표 필요자금(가격+취득세)</span><span>{fmtManwon(targetPrice + (targetTax?.total || 0))}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: `1px solid ${PALETTE.border}`, fontWeight: 800, color: needed > 0 ? PALETTE.down : PALETTE.up }}>
                    <span>{needed > 0 ? '추가로 필요한 자금' : '남는 자금'}</span><span>{fmtManwon(Math.abs(needed))}</span>
                  </div>
                </div>
              );
            })()}
            <p style={{ fontSize: 9.5, color: PALETTE.textMuted, margin: '8px 0 0' }}>
              중개보수·이사비·법무비 등은 대략치예요. 실제 자금 계획은 은행·중개사 확인이 필요해요.
            </p>
          </div>
        )}
        {(aptBasicInfo || nearestStationInfo || isRegulatedByCode(selectedApt.regionCode)) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {isRegulatedByCode(selectedApt.regionCode) && (
              <span style={{ ...styles.chip, background: 'rgba(239,68,68,0.12)', borderColor: PALETTE.accent }}>
                규제지역(투기과열지구·조정대상지역)
              </span>
            )}
            {aptBasicInfo?.households && <span style={styles.chip}>세대수 {aptBasicInfo.households}</span>}
            {aptBasicInfo?.dongCount && <span style={styles.chip}>{aptBasicInfo.dongCount}개동</span>}
            {aptBasicInfo?.useDate && <span style={styles.chip}>준공 {String(aptBasicInfo.useDate).slice(0, 4)}년</span>}
            {aptBasicInfo?.useDate && (() => {
              const buildY = parseInt(String(aptBasicInfo.useDate).slice(0, 4), 10);
              if (!Number.isFinite(buildY)) return null;
              const age = new Date().getFullYear() - buildY;
              const label = age <= 5 ? '신축' : age <= 10 ? '준신축' : age <= 20 ? '구축' : '노후단지';
              const color = age <= 5 ? PALETTE.up : age <= 10 ? PALETTE.accent : age <= 20 ? PALETTE.textSecondary : PALETTE.down;
              return <span style={{ ...styles.chip, color, borderColor: color }}>{label} (준공 {age}년차)</span>;
            })()}
            {aptBasicInfo?.builder && <span style={styles.chip}>시공 {aptBasicInfo.builder}</span>}
            {nearestStationInfo && (
              <span style={styles.chip}>
                {nearestStationInfo.name}역({nearestStationInfo.line}) 도보 {nearestStationInfo.walkMin}분
              </span>
            )}
          </div>
        )}
        <div style={{ marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(() => {
            const isPinned = pinnedComplexes.some((p) => p.apt === selectedApt.apt && p.dong === selectedApt.dong && p.regionCode === selectedApt.regionCode);
            return (
              <button
                className="ui-btn"
                style={{ ...styles.btn, width: 'auto', padding: '7px 12px', fontSize: 12, background: isPinned ? PALETTE.up : undefined }}
                disabled={!isPinned && pinnedComplexes.length >= 5}
                onClick={() => {
                  const key = { apt: selectedApt.apt, dong: selectedApt.dong, regionCode: selectedApt.regionCode };
                  setPinnedComplexes((prev) => (isPinned
                    ? prev.filter((p) => !(p.apt === key.apt && p.dong === key.dong && p.regionCode === key.regionCode))
                    : prev.length >= 5 ? prev : [...prev, key]));
                }}
              >
                {isPinned ? '✓ 비교 목록에 있음' : `📊 단지 비교에 추가 (${pinnedComplexes.length}/5)`}
              </button>
            );
          })()}
        </div>
        <div style={{ marginBottom: 14 }}>
          {!alertFormOpen ? (
            <button className="ui-btn" style={{ ...styles.btn, width: 'auto', padding: '7px 12px', fontSize: 12 }} onClick={() => setAlertFormOpen(true)}>
              🔔 이 단지 가격 알림 등록
            </button>
          ) : (
            <div style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <select value={alertDirection} onChange={(e) => setAlertDirection(e.target.value)} style={{ ...styles.select, width: 'auto', fontSize: 12 }}>
                <option value="below">이하로 떨어지면</option>
                <option value="above">이상으로 오르면</option>
              </select>
              <input
                type="number"
                placeholder="목표가(억원)"
                value={alertTargetPrice}
                onChange={(e) => setAlertTargetPrice(e.target.value)}
                style={{ width: 100, padding: '6px 8px', borderRadius: 6, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
              />
              <button className="ui-btn" style={{ ...styles.btn, width: 'auto', padding: '6px 12px', fontSize: 12 }} onClick={submitAlert} disabled={alertSaving}>
                {alertSaving ? '등록 중...' : '등록'}
              </button>
              <span style={{ fontSize: 11, color: PALETTE.textMuted, cursor: 'pointer' }} onClick={() => setAlertFormOpen(false)}>취소</span>
            </div>
          )}
          <p style={{ fontSize: 9.5, color: PALETTE.textMuted, margin: '4px 0 0' }}>
            등록한 알림은 "즐겨찾기" 탭에서 관리할 수 있어요. 매일 자동으로 확인해서 조건을 만족하면 알려드려요.
          </p>
        </div>
        {schoolsLoading && nearbySchools.length === 0 && (
          <p style={{ fontSize: 11, color: PALETTE.textMuted, marginBottom: 10 }}>인근 학교 찾는 중...</p>
        )}
        {nearbySchools.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {nearbySchools.map((s) => (
              <span key={s.name} style={styles.chip}>{s.name} ({s.kind}{s.foundType ? `·${s.foundType}` : ''})</span>
            ))}
          </div>
        )}
        {aptHistoryAreaOptions.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: PALETTE.textMuted }}>평형대</span>
            <button
              onClick={() => { setHistoryAreaFilter('all'); setHistoryListLimit(30); }}
              style={{
                border: `1px solid ${historyAreaFilter === 'all' ? PALETTE.accent : PALETTE.border}`,
                background: historyAreaFilter === 'all' ? 'rgba(239,68,68,0.10)' : 'transparent',
                color: historyAreaFilter === 'all' ? PALETTE.up : PALETTE.textSecondary,
                borderRadius: 8, padding: '3px 8px', fontSize: 11, cursor: 'pointer',
              }}
            >
              전체
            </button>
            {aptHistoryAreaOptions.map((o) => (
              <button
                key={o.value}
                onClick={() => { setHistoryAreaFilter(o.value); setHistoryListLimit(30); }}
                style={{
                  border: `1px solid ${historyAreaFilter === o.value ? PALETTE.accent : PALETTE.border}`,
                  background: historyAreaFilter === o.value ? 'rgba(239,68,68,0.10)' : 'transparent',
                  color: historyAreaFilter === o.value ? PALETTE.up : PALETTE.textSecondary,
                  borderRadius: 8, padding: '3px 8px', fontSize: 11, cursor: 'pointer',
                }}
              >
                {o.label} ({o.count})
              </button>
            ))}
          </div>
        )}
        {aptHistoryAreaOptions.length > 1 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {[['single', '단일 평형'], ['compare', '평형별 겹쳐보기']].map(([k, l]) => (
              <button
                key={k}
                onClick={() => setTrendViewMode(k)}
                style={{
                  border: `1px solid ${trendViewMode === k ? PALETTE.accent : PALETTE.border}`,
                  background: trendViewMode === k ? 'rgba(239,68,68,0.10)' : 'transparent',
                  color: trendViewMode === k ? PALETTE.up : PALETTE.textSecondary,
                  borderRadius: 8, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer',
                }}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        {trendViewMode === 'single' && aptTrendData.length > 1 && (
          <div style={{ width: '100%', height: 160, marginBottom: 16 }}>
            <ResponsiveContainer>
              <LineChart data={aptTrendData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={PALETTE.border} vertical={false} />
                <XAxis dataKey="ym" stroke={PALETTE.textMuted} fontSize={10} tickLine={false} />
                <YAxis stroke={PALETTE.textMuted} fontSize={10} tickLine={false} width={46} />
                <Tooltip
                  contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                  labelStyle={{ color: PALETTE.textPrimary }}
                  formatter={(v) => `${v.toLocaleString()}만원`}
                />
                <Line type="monotone" dataKey="가격" stroke={PALETTE.accent} strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {trendViewMode === 'compare' && aptTrendByArea.data.length > 1 && (
          <div style={{ width: '100%', height: 180, marginBottom: 16 }}>
            <ResponsiveContainer>
              <LineChart data={aptTrendByArea.data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={PALETTE.border} vertical={false} />
                <XAxis dataKey="ym" stroke={PALETTE.textMuted} fontSize={10} tickLine={false} />
                <YAxis stroke={PALETTE.textMuted} fontSize={10} tickLine={false} width={46} />
                <Tooltip
                  contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                  labelStyle={{ color: PALETTE.textPrimary }}
                  formatter={(v) => (v == null ? '-' : `${v.toLocaleString()}만원`)}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {aptTrendByArea.seriesKeys.map((k, i) => (
                  <Line key={k} type="monotone" dataKey={k} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {aptVolumeData.length > 1 && (
          <div style={{ width: '100%', height: 90, marginBottom: 16 }}>
            <ResponsiveContainer>
              <BarChart data={aptVolumeData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <XAxis dataKey="ym" stroke={PALETTE.textMuted} fontSize={10} tickLine={false} />
                <YAxis stroke={PALETTE.textMuted} fontSize={10} tickLine={false} width={30} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                  labelStyle={{ color: PALETTE.textPrimary }}
                  formatter={(v) => `${v}건`}
                />
                <Bar dataKey="건수" fill={PALETTE.down} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p style={{ fontSize: 10.5, color: PALETTE.textMuted, margin: '2px 0 0', textAlign: 'center' }}>월별 거래건수</p>
          </div>
        )}
        {radiusSummary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
            {radiusSummary.map((r) => (
              <div key={r.radius} style={{ background: PALETTE.panelAlt, borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>{r.radius < 1000 ? `${r.radius}m` : `${r.radius / 1000}km`} 이내</div>
                <div style={{ fontSize: 13, fontWeight: 800, marginTop: 2 }}>단지 {r.count}개</div>
                <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>{r.avg != null ? `평균 ${fmtManwon(Math.round(r.avg))}` : '가격정보 없음'}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>주변 단지 비교</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[[500, '500m'], [1000, '1km'], [2000, '2km']].map(([r, l]) => (
                <button
                  key={r}
                  onClick={() => setNearbyRadius(r)}
                  style={{
                    border: `1px solid ${nearbyRadius === r ? PALETTE.accent : PALETTE.border}`,
                    background: nearbyRadius === r ? 'rgba(239,68,68,0.10)' : 'transparent',
                    color: nearbyRadius === r ? PALETTE.up : PALETTE.textSecondary,
                    borderRadius: 8, padding: '3px 9px', fontSize: 11, cursor: 'pointer',
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          {nearbyComplexes.length === 0 ? (
            <p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: 0 }}>이 반경 안에 좌표가 확인된 다른 단지가 없어요. 반경을 넓혀보세요.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...styles.th, fontSize: 10.5 }}>단지</th>
                    <th style={{ ...styles.th, fontSize: 10.5 }}>거리</th>
                    <th style={{ ...styles.th, fontSize: 10.5 }}>최근 거래가</th>
                    <th style={{ ...styles.th, fontSize: 10.5 }}>평당가</th>
                  </tr>
                </thead>
                <tbody>
                  {nearbyComplexes.map((c) => (
                    <tr key={c.key} style={{ cursor: 'pointer' }} onClick={() => setSelectedApt({ apt: c.apt, dong: c.dong, regionCode: c.regionCode, lat: c.lat, lng: c.lng })}>
                      <td style={{ ...styles.td, fontSize: 11.5, color: PALETTE.accent }}>{c.apt}<div style={{ fontSize: 9.5, color: PALETTE.textMuted }}>{c.dong}</div></td>
                      <td style={{ ...styles.td, fontSize: 11.5 }}>{c.distance < 1000 ? `${Math.round(c.distance)}m` : `${(c.distance / 1000).toFixed(1)}km`}</td>
                      <td style={{ ...styles.td, fontSize: 11.5 }}>{c.latestPrice != null ? fmtManwon(c.latestPrice) : '-'}</td>
                      <td style={{ ...styles.td, fontSize: 11.5 }}>{c.latestPyeong != null ? fmtManwon(Math.round(c.latestPyeong)) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: 9.5, color: PALETTE.textMuted, margin: '8px 0 0' }}>
            동 중심좌표 기준 거리라 실제 위치와 다소 차이가 있을 수 있어요.
          </p>
        </div>
        {similarComplexes.length > 0 && (
          <div style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>비교 조건이 유사한 단지</span>
              <button
                className="ui-btn"
                style={{ ...styles.btn, width: 'auto', padding: '4px 9px', fontSize: 10.5 }}
                onClick={() => {
                  const keys = new Set(similarComplexes.map((c) => `${c.regionCode}|${c.dong}|${c.apt}`));
                  keys.add(`${selectedApt.regionCode}|${selectedApt.dong}|${selectedApt.apt}`);
                  setMapFocusKeys(keys);
                  setSelectedApt(null);
                  setViewMode('map');
                }}
              >
                🗺️ 지도에서 보기
              </button>
            </div>
            <p style={{ fontSize: 10, color: PALETTE.textMuted, margin: '4px 0 8px' }}>
              평형(±5평)·가격·거리를 종합해 가까운 순이에요. 준공연도·세대수는 아직 전체 비교에 못 써요(지금 보는 단지에만 있어요).
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
              {similarComplexes.map((c) => (
                <div
                  key={`${c.regionCode}|${c.dong}|${c.apt}`}
                  onClick={() => setSelectedApt({ apt: c.apt, dong: c.dong, regionCode: c.regionCode })}
                  style={{ background: PALETTE.panel, borderRadius: 8, padding: 9, cursor: 'pointer', border: `1px solid ${PALETTE.border}` }}
                >
                  <div style={{ fontSize: 11.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.apt}</div>
                  <div style={{ fontSize: 10, color: PALETTE.textMuted, margin: '2px 0' }}>{fmtArea(c.area)} · {labelFor(c.regionCode)}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <b style={{ fontSize: 12 }}>{fmtManwon(Math.round(c.unitPrice))}/평</b>
                    <span style={{ fontSize: 10, color: c.priceDiffPct > 0 ? PALETTE.up : c.priceDiffPct < 0 ? PALETTE.down : PALETTE.textMuted }}>
                      {fmtPct(c.priceDiffPct)}
                    </span>
                  </div>
                  <div style={{ fontSize: 9.5, color: PALETTE.textMuted, marginTop: 3 }}>
                    {c.distance != null && `${c.distance < 1000 ? `${Math.round(c.distance)}m` : `${(c.distance / 1000).toFixed(1)}km`} · `}
                    평형 {c.pyeongDiff > 0 ? '+' : ''}{c.pyeongDiff.toFixed(0)}평
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...styles.th, width: 60 }}>동</th>
                <th style={{ ...styles.th, width: 90 }}>계약일</th>
                <th style={{ ...styles.th, width: 130 }}>전용면적</th>
                <th style={{ ...styles.th, width: 50 }}>층</th>
                {isRent ? (
                  <>
                    <th style={{ ...styles.th, width: 55 }}>구분</th>
                    <th style={{ ...styles.th, width: 110 }}>보증금</th>
                    <th style={{ ...styles.th, width: 90 }}>월세</th>
                  </>
                ) : (
                  <th style={{ ...styles.th, width: 120 }}>거래금액</th>
                )}
              </tr>
            </thead>
            <tbody>
              {aptHistoryFiltered.slice(0, historyListLimit).map((t, i) => (
                <tr key={i}>
                  <td style={styles.td}>{t.aptDong ? `${t.aptDong}동` : '-'}</td>
                  <td style={styles.td}>{t.year}.{t.month}.{t.day}</td>
                  <td style={styles.td}>{fmtArea(t.area)}</td>
                  <td style={styles.td}>{t.floor}층</td>
                  {isRent ? (
                    <>
                      <td style={styles.td}>{t.isJeonse ? '전세' : '월세'}</td>
                      <td style={styles.td}>{fmtManwon(t.deposit)}</td>
                      <td style={styles.td}>{t.isJeonse ? '-' : `${t.monthlyRent.toLocaleString()}만원`}</td>
                    </>
                  ) : (
                    <td style={styles.td}>{fmtManwon(t.amount)}</td>
                  )}
                </tr>
              ))}
              {aptHistoryFiltered.length === 0 && (
                <tr><td style={styles.td} colSpan={isRent ? 7 : 5}>표시할 거래 내역이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
          {aptHistoryFiltered.length > historyListLimit && (
            <div style={{ textAlign: 'center', marginTop: 10 }}>
              <button
                className="ui-btn"
                style={{ ...styles.btn, width: 'auto', padding: '7px 16px', fontSize: 12 }}
                onClick={() => setHistoryListLimit((n) => n + 30)}
              >
                더보기 ({aptHistoryFiltered.length - historyListLimit}건 더 있음)
              </button>
            </div>
          )}
        </div>
    </>
  );

  if (isPanel) {
    return (
      <FloatingWindow
        title={`${selectedApt.apt} (${selectedApt.dong})`}
        onClose={() => setSelectedApt(null)}
        onInsetChange={onPanelInsetChange}
      >
        {detailBody}
      </FloatingWindow>
    );
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(30,28,24,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
      }}
      onClick={() => setSelectedApt(null)}
    >
      <div
        style={{
          background: PALETTE.panel, borderRadius: 18, padding: 20, width: '100%', maxWidth: 640,
          maxHeight: '80vh', overflowY: 'auto', border: `1px solid ${PALETTE.border}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em', margin: 0 }}>
            {selectedApt.apt} ({selectedApt.dong})
          </h2>
          <X size={18} style={{ cursor: 'pointer', color: PALETTE.textMuted }} onClick={() => setSelectedApt(null)} />
        </div>
        {detailBody}
      </div>
    </div>
  );
}

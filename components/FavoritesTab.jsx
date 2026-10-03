import React from 'react';
import { X } from 'lucide-react';
import {
  PALETTE, fmtPct, fmtManwon, fmtWon, labelFor, monthLabel, calcAcquisitionTax,
  LISTING_STATUSES, VISIT_CHECK_ITEMS, VISIT_RATINGS,
} from '../lib/ui-helpers';

// 즐겨찾기 탭(저장 조건 + 관심단지·알림 + 매물 호가 기록 + 현장답사 체크리스트 + 자금계획).
// app/page.jsx 안에 있던 viewMode === 'favorites' 블록을 그대로 옮긴 것.
export default function FavoritesTab({
  favorites, applyFavorite, setViewMode, removeFavorite,
  userAlerts, complexCompare, setSelectedApt, isRent, removeUserAlert, addRegionAndFetch,
  listingForm, setListingForm, addListing,
  myListingsWithComparison, updateListingStatus, removeListing,
  pinnedComplexes, setPinnedComplexes,
  visitForm, setVisitForm, addVisit, myVisits, removeVisit,
  scenario, setScenario, myListings,
  styles,
}) {
  return (
    <div style={{ padding: '20px 20px 0' }}>
      <div style={styles.card} className="ui-card">
        <h2 style={styles.sectionTitle}>즐겨찾기</h2>
        <p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: '-6px 0 14px' }}>
          저장해둔 조건 조합이에요. 클릭 한 번으로 그 설정 그대로 불러올 수 있어요.
        </p>
        {favorites.length === 0 ? (
          <p style={{ fontSize: 13, color: PALETTE.textMuted }}>
            아직 저장된 즐겨찾기가 없어요. 대시보드 탭 왼쪽 패널에서 조건을 설정한 뒤 이름을 붙여 저장해보세요.
          </p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
            {favorites.map((fav) => (
              <div
                key={fav.name}
                style={{
                  ...styles.card, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8,
                }}
                className="ui-card"
                onClick={() => { applyFavorite(fav); setViewMode('normal'); }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{fav.name}</span>
                  <X
                    size={14}
                    color={PALETTE.textMuted}
                    style={{ cursor: 'pointer', flexShrink: 0 }}
                    onClick={(e) => { e.stopPropagation(); removeFavorite(fav.name); }}
                  />
                </div>
                <div style={{ fontSize: 12, color: PALETTE.textSecondary }}>
                  {{ trade: '매매', rent: '전월세', rone: '시세동향', ratio: '전세가율', silv: '분양권전매' }[fav.dealType] || fav.dealType}
                  {' · '}
                  {fav.startYm ? `${monthLabel(fav.startYm)} ~ ${monthLabel(fav.endYm)}` : ''}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {fav.selected.slice(0, 4).map((code) => (
                    <span key={code} style={{ ...styles.chip, padding: '2px 8px', fontSize: 10.5 }}>{labelFor(code)}</span>
                  ))}
                  {fav.selected.length > 4 && (
                    <span style={{ fontSize: 10.5, color: PALETTE.textMuted }}>+{fav.selected.length - 4}개 더</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ ...styles.card, marginTop: 16 }} className="ui-card">
        <h2 style={styles.sectionTitle}>관심 단지 현황 · 가격 알림</h2>
        <p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: '-6px 0 14px' }}>
          단지 상세 화면에서 등록한 알림이에요. 매일 자동으로 확인해서 조건을 만족하면 알려드려요.
        </p>
        {userAlerts.length === 0 ? (
          <p style={{ fontSize: 13, color: PALETTE.textMuted }}>
            등록된 알림이 없어요. 지도에서 단지를 클릭한 뒤 "🔔 이 단지 가격 알림 등록"을 눌러보세요.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {userAlerts.map((a) => {
              const key = `${a.regionCode}|${a.dong}|${a.apt}`;
              const live = complexCompare.find((c) => `${c.regionCode}|${c.dong}|${c.apt}` === key);
              return (
              <div key={a.id} style={{
                background: PALETTE.panelAlt, borderRadius: 10, padding: '10px 12px',
              }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, cursor: 'pointer' }} onClick={() => setSelectedApt({ apt: a.apt, dong: a.dong, regionCode: a.regionCode })}>
                      {a.apt} <span style={{ fontWeight: 400, color: PALETTE.textMuted, fontSize: 11 }}>({a.regionName} {a.dong})</span>
                    </div>
                    <div style={{ fontSize: 12, color: PALETTE.textSecondary, marginTop: 2 }}>
                      알림가 {fmtManwon(a.targetPrice)} {a.direction === 'above' ? '이상' : '이하'}
                      {a.firedAt && <span style={{ color: PALETTE.up, marginLeft: 6 }}>✓ 알림 발송됨</span>}
                    </div>
                  </div>
                  <X size={14} color={PALETTE.textMuted} style={{ cursor: 'pointer' }} onClick={() => removeUserAlert(a.id)} />
                </div>
                {live ? (
                  <div style={{ display: 'flex', gap: 12, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${PALETTE.border}`, fontSize: 11.5 }}>
                    <span>최근가 <b>{fmtWon(isRent ? live.deposit : live.amount)}</b></span>
                    <span>거래 <b>{live.count}건</b></span>
                    <span style={{ color: live.change > 0 ? PALETTE.up : live.change < 0 ? PALETTE.down : PALETTE.textSecondary }}>변동 <b>{fmtPct(live.change)}</b></span>
                  </div>
                ) : (
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${PALETTE.border}`, fontSize: 10.5, color: PALETTE.textMuted }}>
                    <span
                      style={{ cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={() => addRegionAndFetch(a.regionCode)}
                    >
                      이 지역을 선택하면 최신 거래 정보가 보여요 →
                    </span>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ ...styles.card, marginTop: 16 }} className="ui-card">
        <h2 style={styles.sectionTitle}>매물 호가 기록</h2>
        <p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: '-6px 0 14px' }}>
          실제로 보고 있는 매물 호가를 적어두면, 현재 조회된 실거래와 비교해줘요. 이 기기(브라우저)에만 저장돼요.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 10 }}>
          <input placeholder="단지명" value={listingForm.apt} onChange={(e) => setListingForm({ ...listingForm, apt: e.target.value })} style={{ ...styles.select, fontSize: 12.5 }} />
          <input placeholder="동(예: 화명동)" value={listingForm.dong} onChange={(e) => setListingForm({ ...listingForm, dong: e.target.value })} style={{ ...styles.select, fontSize: 12.5 }} />
          <input placeholder="전용면적(㎡)" type="number" value={listingForm.area} onChange={(e) => setListingForm({ ...listingForm, area: e.target.value })} style={{ ...styles.select, fontSize: 12.5 }} />
          <input placeholder="층" value={listingForm.floor} onChange={(e) => setListingForm({ ...listingForm, floor: e.target.value })} style={{ ...styles.select, fontSize: 12.5 }} />
          <input placeholder="호가(억원)" type="number" value={listingForm.price} onChange={(e) => setListingForm({ ...listingForm, price: e.target.value })} style={{ ...styles.select, fontSize: 12.5 }} />
          <select value={listingForm.status} onChange={(e) => setListingForm({ ...listingForm, status: e.target.value })} style={{ ...styles.select, fontSize: 12.5 }}>
            {LISTING_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input placeholder="메모 (예: 급매, 수리 필요 등)" value={listingForm.memo} onChange={(e) => setListingForm({ ...listingForm, memo: e.target.value })} style={{ ...styles.select, fontSize: 12.5, flex: 1 }} />
          <button className="ui-btn" style={{ ...styles.btn, width: 'auto', padding: '8px 16px' }} onClick={addListing} disabled={!listingForm.apt || !listingForm.price}>+ 기록</button>
        </div>
        {myListingsWithComparison.length === 0 ? (
          <p style={{ fontSize: 13, color: PALETTE.textMuted }}>아직 기록한 매물이 없어요.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {myListingsWithComparison.map((l) => (
              <div key={l.id} style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      {l.apt} <span style={{ fontWeight: 400, color: PALETTE.textMuted, fontSize: 11 }}>({l.dong} {l.area}㎡ {l.floor && `${l.floor}층`})</span>
                    </div>
                    <div style={{ fontSize: 12, color: PALETTE.textSecondary, marginTop: 2 }}>
                      호가 {fmtManwon(parseFloat(l.price) * 10000)} · 확인일 {l.checkedAt}
                      {l.memo && <span style={{ color: PALETTE.textMuted }}> · {l.memo}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <select value={l.status} onChange={(e) => updateListingStatus(l.id, e.target.value)} style={{ fontSize: 11, padding: '3px 6px', borderRadius: 6, border: `1px solid ${PALETTE.border}` }}>
                      {LISTING_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                    </select>
                    <X size={14} color={PALETTE.textMuted} style={{ cursor: 'pointer' }} onClick={() => removeListing(l.id)} />
                  </div>
                </div>
                {l.history && l.history.length > 1 && (
                  <div style={{ marginTop: 6, fontSize: 10, color: PALETTE.textMuted }}>
                    상태 변경 {l.history.length - 1}회 · {l.history.map((h) => `${h.date.slice(5)} ${h.status}`).join(' → ')}
                  </div>
                )}
                {l.comparable ? (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${PALETTE.border}`, fontSize: 11.5 }}>
                    비슷한 최근 실거래 {l.usedCount}건 평균 <b>{fmtManwon(Math.round(l.avg))}</b>
                    <span style={{ marginLeft: 8, color: l.diff > 0 ? PALETTE.down : PALETTE.up }}>
                      호가와 차이 {l.diff > 0 ? '+' : ''}{fmtManwon(Math.round(l.diff))} ({l.diffPct > 0 ? '+' : ''}{l.diffPct.toFixed(1)}%)
                    </span>
                    <div style={{ fontSize: 10, color: PALETTE.textMuted, marginTop: 3 }}>
                      가장 최근 매칭 거래 {l.latestYm}{l.monthsAgo > 0 ? ` (${l.monthsAgo}개월 전)` : ''}
                      {l.monthsAgo >= 6 ? ' · 오래된 거래라 현재 시세와 차이가 클 수 있어요' : ''}
                      · 협상 여지나 적정가를 판단하는 값이 아니라 참고용 차이예요.
                    </div>
                    {(() => {
                      const pinKey = { apt: l.apt, dong: l.matchedDong, regionCode: l.matchedRegionCode };
                      const isPinned = pinnedComplexes.some((p) => p.apt === pinKey.apt && p.dong === pinKey.dong && p.regionCode === pinKey.regionCode);
                      return (
                        <button
                          className="ui-btn"
                          style={{ ...styles.btn, width: 'auto', padding: '4px 9px', fontSize: 10.5, marginTop: 6, background: isPinned ? PALETTE.up : undefined }}
                          disabled={!isPinned && pinnedComplexes.length >= 5}
                          onClick={() => setPinnedComplexes((prev) => (isPinned
                            ? prev.filter((p) => !(p.apt === pinKey.apt && p.dong === pinKey.dong && p.regionCode === pinKey.regionCode))
                            : prev.length >= 5 ? prev : [...prev, pinKey]))}
                        >
                          {isPinned ? '✓ 비교 목록에 있음' : `📊 비교 목록에 추가 (${pinnedComplexes.length}/5)`}
                        </button>
                      );
                    })()}
                  </div>
                ) : (
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${PALETTE.border}`, fontSize: 10.5, color: PALETTE.textMuted }}>
                    {l.reason || '비교 자료 부족'} 해당 지역을 선택해 조회하면 비교할 수 있어요.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ ...styles.card, marginTop: 16 }} className="ui-card">
        <h2 style={styles.sectionTitle}>현장답사 체크리스트</h2>
        <p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: '-6px 0 14px' }}>
          직접 가서 확인한 내용을 기록해두면 나중에 단지끼리 비교할 때 도움이 돼요. 이 기기(브라우저)에만 저장돼요.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 10 }}>
          <input placeholder="단지명" value={visitForm.apt} onChange={(e) => setVisitForm({ ...visitForm, apt: e.target.value })} style={{ ...styles.select, fontSize: 12.5 }} />
          <input placeholder="동(선택)" value={visitForm.dong} onChange={(e) => setVisitForm({ ...visitForm, dong: e.target.value })} style={{ ...styles.select, fontSize: 12.5 }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 10 }}>
          {VISIT_CHECK_ITEMS.map((item) => (
            <div key={item}>
              <label style={{ fontSize: 10.5, color: PALETTE.textMuted }}>{item}</label>
              <select
                value={visitForm.checks[item]}
                onChange={(e) => setVisitForm({ ...visitForm, checks: { ...visitForm.checks, [item]: e.target.value } })}
                style={{ ...styles.select, fontSize: 12.5 }}
              >
                <option value="">-</option>
                {VISIT_RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input placeholder="메모 (예: 남향 위주 동, 엘리베이터 대기 김)" value={visitForm.memo} onChange={(e) => setVisitForm({ ...visitForm, memo: e.target.value })} style={{ ...styles.select, fontSize: 12.5, flex: 1 }} />
          <button className="ui-btn" style={{ ...styles.btn, width: 'auto', padding: '8px 16px' }} onClick={addVisit} disabled={!visitForm.apt}>+ 기록</button>
        </div>
        {myVisits.length === 0 ? (
          <p style={{ fontSize: 13, color: PALETTE.textMuted }}>아직 기록한 답사가 없어요.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {myVisits.map((v) => (
              <div key={v.id} style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      {v.apt} <span style={{ fontWeight: 400, color: PALETTE.textMuted, fontSize: 11 }}>{v.dong && `(${v.dong})`} · 방문일 {v.visitedAt}</span>
                    </div>
                    {v.memo && <div style={{ fontSize: 12, color: PALETTE.textSecondary, marginTop: 2 }}>{v.memo}</div>}
                  </div>
                  <X size={14} color={PALETTE.textMuted} style={{ cursor: 'pointer', flexShrink: 0 }} onClick={() => removeVisit(v.id)} />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {VISIT_CHECK_ITEMS.filter((item) => v.checks?.[item]).map((item) => {
                    const val = v.checks[item];
                    const color = val === '좋음' ? PALETTE.up : val === '나쁨' ? PALETTE.down : PALETTE.textSecondary;
                    return (
                      <span key={item} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, background: PALETTE.panel, color }}>
                        {item} {val}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ ...styles.card, marginTop: 16 }} className="ui-card">
        <h2 style={styles.sectionTitle}>자금 계획 시나리오 (월 상환액)</h2>
        <p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: '-6px 0 14px' }}>
          매매가와 보유 현금을 넣으면 취득세를 더한 초기 필요자금과, 금리별 월 상환액(원리금균등)을 비교해줘요.
          세금·대출 규정은 개인 조건과 시점에 따라 달라서, 실제 심사·세무 계산을 대체하지 않는 가정 기반 참고용이에요.
        </p>
        {myListings.length > 0 && (
          <select
            value={scenario.listingId}
            onChange={(e) => {
              const l = myListings.find((x) => x.id === e.target.value);
              setScenario({ ...scenario, listingId: e.target.value, price: l ? l.price : scenario.price });
            }}
            style={{ ...styles.select, fontSize: 12.5, marginBottom: 8, maxWidth: 360 }}
          >
            <option value="">기록한 매물에서 불러오기 (선택)</option>
            {myListings.map((l) => <option key={l.id} value={l.id}>{l.apt} {l.area && `${l.area}㎡`} · {l.price}억</option>)}
          </select>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 10.5, color: PALETTE.textMuted }}>매매가(억원)</label>
            <input type="number" value={scenario.price} onChange={(e) => setScenario({ ...scenario, price: e.target.value })} style={{ ...styles.select, fontSize: 12.5 }} />
          </div>
          <div>
            <label style={{ fontSize: 10.5, color: PALETTE.textMuted }}>보유 현금(억원)</label>
            <input type="number" value={scenario.cash} onChange={(e) => setScenario({ ...scenario, cash: e.target.value })} style={{ ...styles.select, fontSize: 12.5 }} />
          </div>
          <div>
            <label style={{ fontSize: 10.5, color: PALETTE.textMuted }}>기준 금리(%)</label>
            <input type="number" step="0.1" value={scenario.rate} onChange={(e) => setScenario({ ...scenario, rate: e.target.value })} style={{ ...styles.select, fontSize: 12.5 }} />
          </div>
          <div>
            <label style={{ fontSize: 10.5, color: PALETTE.textMuted }}>상환기간(년)</label>
            <input type="number" value={scenario.years} onChange={(e) => setScenario({ ...scenario, years: e.target.value })} style={{ ...styles.select, fontSize: 12.5 }} />
          </div>
        </div>
        {(() => {
          const priceM = parseFloat(scenario.price) * 10000;
          if (!Number.isFinite(priceM) || priceM <= 0) return null;
          const cashM = (parseFloat(scenario.cash) || 0) * 10000;
          const tax = calcAcquisitionTax(priceM);
          const totalNeed = priceM + (tax?.total || 0);
          const loan = Math.max(0, totalNeed - cashM);
          const years = parseFloat(scenario.years);
          const baseRate = parseFloat(scenario.rate);
          const n = Math.round(years * 12);
          const monthly = (annualPct) => {
            if (!loan || !Number.isFinite(n) || n <= 0) return 0;
            const r = annualPct / 100 / 12;
            if (r === 0) return loan / n;
            return (loan * r) / (1 - (1 + r) ** -n);
          };
          const rates = [baseRate - 1, baseRate, baseRate + 1].filter((r) => Number.isFinite(r) && r >= 0);
          return (
            <div style={{ background: PALETTE.panelAlt, borderRadius: 8, padding: 12, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span>매매가</span><span>{fmtManwon(priceM)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span>+ 취득세 등 (추정)</span><span>{fmtManwon(Math.round(tax?.total || 0))}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: `1px solid ${PALETTE.border}`, fontWeight: 700 }}><span>초기 필요자금</span><span>{fmtManwon(Math.round(totalNeed))}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span>− 보유 현금</span><span>{fmtManwon(cashM)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: `1px solid ${PALETTE.border}`, fontWeight: 800, color: loan > 0 ? PALETTE.down : PALETTE.up }}>
                <span>{loan > 0 ? '필요한 대출(가정)' : '대출 없이 가능'}</span><span>{fmtManwon(Math.round(loan))}</span>
              </div>
              {loan > 0 && (
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: `repeat(${rates.length}, 1fr)`, gap: 6 }}>
                  {rates.map((r) => (
                    <div key={r} style={{ background: PALETTE.panel, borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
                      <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>금리 {r.toFixed(1)}%</div>
                      <div style={{ fontSize: 13.5, fontWeight: 800, marginTop: 2 }}>월 {fmtManwon(Math.round(monthly(r)))}</div>
                    </div>
                  ))}
                </div>
              )}
              <p style={{ fontSize: 9.5, color: PALETTE.textMuted, margin: '8px 0 0' }}>
                원리금균등 방식 가정이에요. 실제 대출 가능액은 소득·DSR·LTV·규제지역 여부에 따라 달라지고, 중개보수·이사비 등은 포함하지 않았어요.
              </p>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

import React from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { X } from 'lucide-react';
import { REGION_GROUPS, SIDO_AGGREGATES } from '../lib/regions';
import {
  PALETTE, fmtPct, fmtManwon, fmtWon, labelFor, monthLabel,
} from '../lib/ui-helpers';

// 시장분석센터 탭. app/page.jsx 안에 있던 viewMode === 'market' 블록을 그대로 옮긴 것.
export default function MarketTab({
  comparePickerValue, addRegionAndFetch, selected, removeRegion, status,
  analyticsPeriod, setAnalyticsPeriod, advancedAnalytics,
  analyticsView, setAnalyticsView, marketIntensity, ratioKpis,
  setSelectedApt, marketSignals,
  styles,
}) {
  return (
    <div style={{ padding: '20px 20px 44px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 className="dash-title" style={{ ...styles.sectionTitle, fontSize: 26, marginBottom: 5 }}>시장분석센터</h1>
          <p style={{ fontSize: 12, color: PALETTE.textMuted, margin: 0 }}>현재 조회한 실거래를 바탕으로 가격·거래량·신고가·고점대비 하락폭을 한 화면에서 확인합니다.</p>
        </div>
        <button className="ui-btn no-print" style={{ ...styles.btn, width: 'auto', padding: '8px 14px', fontSize: 12.5 }} onClick={() => window.print()}>
          📄 PDF로 내보내기
        </button>
      </div>
      <div style={{ ...styles.card, marginBottom: 12 }} className="ui-card no-print">
        <label style={styles.label}>분석할 지역 추가</label>
        <select
          value={comparePickerValue}
          onChange={(e) => addRegionAndFetch(e.target.value)}
          style={{ ...styles.select, fontSize: 13, maxWidth: 320 }}
        >
          <option value="">시/도 - 시/군/구 선택</option>
          {REGION_GROUPS.map((g) => {
            const agg = SIDO_AGGREGATES.find((a) => a.sido === g.sido);
            return (
              <optgroup key={g.sido} label={g.sido}>
                {agg && <option key={agg.code} value={agg.code}>{agg.name}</option>}
                {g.items.map((it) => (
                  <option key={it.code} value={it.code}>{it.name}</option>
                ))}
              </optgroup>
            );
          })}
        </select>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {selected.map((code) => (
            <span key={code} style={styles.chip}>
              {labelFor(code)}
              <X size={11} style={{ cursor: 'pointer' }} onClick={() => removeRegion(code)} />
            </span>
          ))}
          {selected.length === 0 && (
            <span style={{ fontSize: 12, color: PALETTE.textMuted }}>선택된 지역이 없어요. 위에서 지역을 추가해보세요.</span>
          )}
        </div>
        {status === 'loading' && (
          <p style={{ fontSize: 11.5, color: PALETTE.textMuted, marginTop: 8 }}>불러오는 중...</p>
        )}
      </div>
      <div style={{ ...styles.card, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }} className="ui-card no-print">
        <span style={{ fontSize: 12, fontWeight: 700 }}>분석기간</span>
        {['3', '6', '12'].map((v) => (
          <button key={v} className="portal-pill" onClick={() => setAnalyticsPeriod(v)} style={{ background: analyticsPeriod === v ? PALETTE.accent : PALETTE.panelAlt, color: analyticsPeriod === v ? '#fff' : PALETTE.textPrimary }}>{v}개월</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: PALETTE.textMuted }}>조회 {advancedAnalytics.tx.length.toLocaleString()}건 · {advancedAnalytics.rows.length.toLocaleString()}개 단지</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 10, marginBottom: 12 }}>
        {[
          ['평균 최근가', advancedAnalytics.rows.length ? fmtWon(advancedAnalytics.rows.reduce((s, r) => s + r.latest, 0) / advancedAnalytics.rows.length) : '-'],
          ['거래량', `${advancedAnalytics.tx.length.toLocaleString()}건`],
          ['신고가 단지', `${advancedAnalytics.highs.length}개`],
          ['상승 모멘텀', advancedAnalytics.momentum[0] ? fmtPct(advancedAnalytics.momentum[0].mom) : '-'],
          ['최대 하락폭', advancedAnalytics.drawdowns[0] ? fmtPct(advancedAnalytics.drawdowns[0].drawdown) : '-'],
        ].map(([l, v]) => (
          <div key={l} style={styles.card} className="ui-card"><div style={styles.kpiLabel}>{l}</div><div style={{ ...styles.kpiValue, fontSize: 20 }}>{v}</div></div>
        ))}
      </div>
      <div style={{ ...styles.card, marginBottom: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }} className="ui-card no-print">
        {[['overview', '요약'], ['intensity', '시장강도'], ['compare', '가격비교'], ['momentum', '상승 모멘텀'], ['volume', '거래량'], ['highs', '신고가·하락'], ['distribution', '가격분포'], ['signals', '시장신호']].map(([k, l]) => (
          <button key={k} className="portal-pill" onClick={() => setAnalyticsView(k)} style={{ background: analyticsView === k ? PALETTE.textPrimary : PALETTE.panelAlt, color: analyticsView === k ? '#fff' : PALETTE.textPrimary }}>{l}</button>
        ))}
      </div>
      {analyticsView === 'intensity' && (
        <div style={{ ...styles.card, marginBottom: 12 }} className="ui-card">
          <h2 style={styles.sectionTitle}>시장강도</h2>
          <p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: '-6px 0 14px' }}>
            가격·거래량·전세가율을 하나의 점수로 합치지 않고 각각 따로 보여줘요. 기간을 반으로 나눠 전반기·후반기를 비교해요.
          </p>
          {!marketIntensity ? (
            <p style={{ fontSize: 13, color: PALETTE.textMuted }}>비교할 만큼 거래가 충분하지 않아요. 조회 기간을 늘려보세요.</p>
          ) : (
            <>
              <p style={{ fontSize: 11, color: PALETTE.textMuted, margin: '0 0 10px' }}>{marketIntensity.periodLabel} 전반기 vs 후반기</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
                <div style={styles.card}>
                  <div style={styles.kpiLabel}>가격 변화</div>
                  <div style={{ ...styles.kpiValue, fontSize: 20, color: marketIntensity.priceChangePct > 0 ? PALETTE.up : marketIntensity.priceChangePct < 0 ? PALETTE.down : PALETTE.textPrimary }}>
                    {marketIntensity.priceChangePct != null ? fmtPct(marketIntensity.priceChangePct) : '-'}
                  </div>
                </div>
                <div style={styles.card}>
                  <div style={styles.kpiLabel}>거래량 변화</div>
                  <div style={{ ...styles.kpiValue, fontSize: 20, color: marketIntensity.volumeChangePct > 0 ? PALETTE.up : marketIntensity.volumeChangePct < 0 ? PALETTE.down : PALETTE.textPrimary }}>
                    {marketIntensity.volumeChangePct != null ? fmtPct(marketIntensity.volumeChangePct) : '-'}
                  </div>
                  <div style={{ fontSize: 10, color: PALETTE.textMuted, marginTop: 2 }}>
                    {marketIntensity.firstHalfCount}건 → {marketIntensity.secondHalfCount}건
                  </div>
                </div>
                <div style={styles.card}>
                  <div style={styles.kpiLabel}>전세가율(평균)</div>
                  <div style={{ ...styles.kpiValue, fontSize: 20 }}>
                    {ratioKpis.avg != null ? `${ratioKpis.avg.toFixed(1)}%` : '-'}
                  </div>
                  {ratioKpis.avg == null && (
                    <div style={{ fontSize: 9.5, color: PALETTE.textMuted, marginTop: 2 }}>"전세가율" 거래유형으로 조회하면 나와요</div>
                  )}
                </div>
              </div>
              <p style={{ fontSize: 10, color: PALETTE.textMuted }}>
                입주물량·인구 추이는 "대시보드" 탭에서, 신고가·모멘텀은 이 탭의 다른 메뉴에서 같은 기간 기준으로 바로 볼 수 있어요.
              </p>
            </>
          )}
        </div>
      )}
      {analyticsView === 'overview' && (
        <>
          <div style={{ ...styles.card, marginBottom: 12 }} className="ui-card">
            <h2 style={styles.sectionTitle}>월별 거래량</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={advancedAnalytics.monthSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="ym" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="건수" fill={PALETTE.accent} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={styles.card} className="ui-card">
              <h2 style={styles.sectionTitle}>최근 상승 모멘텀</h2>
              {advancedAnalytics.momentum.slice(0, 8).map((r) => (
                <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: `1px solid ${PALETTE.border}`, cursor: 'pointer' }} onClick={() => setSelectedApt({ apt: r.apt, dong: r.dong, regionCode: r.regionCode })}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{r.apt}<small style={{ display: 'block', color: PALETTE.textMuted, fontWeight: 400 }}>{r.dong}</small></span>
                  <b style={{ color: r.mom >= 0 ? PALETTE.up : PALETTE.down }}>{fmtPct(r.mom)}</b>
                </div>
              ))}
            </div>
            <div style={styles.card} className="ui-card">
              <h2 style={styles.sectionTitle}>고점 대비 하락</h2>
              {advancedAnalytics.drawdowns.slice(0, 8).map((r) => (
                <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: `1px solid ${PALETTE.border}`, cursor: 'pointer' }} onClick={() => setSelectedApt({ apt: r.apt, dong: r.dong, regionCode: r.regionCode })}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{r.apt}<small style={{ display: 'block', color: PALETTE.textMuted, fontWeight: 400 }}>{r.dong}</small></span>
                  <b style={{ color: PALETTE.down }}>{fmtPct(r.drawdown)}</b>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {analyticsView === 'compare' && (
        <div style={styles.card} className="ui-card">
          <h2 style={styles.sectionTitle}>단지 가격비교</h2>
          <p style={{ fontSize: 11, color: PALETTE.textMuted }}>최근 거래가와 기간 변동, 거래량을 동시에 비교합니다.</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['단지', '최근가', '평당가', '변동률', '거래량', '고점대비'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
              <tbody>
                {advancedAnalytics.rows.slice().sort((a, b) => (b.unitPrice ?? b.latest) - (a.unitPrice ?? a.latest)).slice(0, 80).map((r) => (
                  <tr key={r.key}>
                    <td style={{ ...styles.td, color: PALETTE.accent, cursor: 'pointer' }} onClick={() => setSelectedApt({ apt: r.apt, dong: r.dong, regionCode: r.regionCode })}>{r.apt}<div style={{ fontSize: 10, color: PALETTE.textMuted }}>{r.dong}</div></td>
                    <td style={styles.td}>{fmtWon(r.latest)}</td>
                    <td style={styles.td}>{r.unitPrice ? fmtManwon(r.unitPrice) : '-'}</td>
                    <td style={{ ...styles.td, color: r.change >= 0 ? PALETTE.up : PALETTE.down }}>{fmtPct(r.change)}</td>
                    <td style={styles.td}>{r.volume}건</td>
                    <td style={{ ...styles.td, color: r.drawdown < 0 ? PALETTE.down : PALETTE.textSecondary }}>{fmtPct(r.drawdown)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {analyticsView === 'momentum' && (
        <div style={styles.card} className="ui-card">
          <h2 style={styles.sectionTitle}>최근 거래 모멘텀</h2>
          <p style={{ fontSize: 11, color: PALETTE.textMuted }}>선택 기간 내 마지막 두 거래의 가격 차이를 계산한 지표입니다. 거래 간 면적 차이는 보정하지 않습니다.</p>
          {advancedAnalytics.momentum.map((r, i) => (
            <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '42px 1fr 100px 90px', gap: 8, padding: '11px 0', borderBottom: `1px solid ${PALETTE.border}`, alignItems: 'center' }}>
              <b>{i + 1}</b>
              <span style={{ fontSize: 12, fontWeight: 700, cursor: 'pointer' }} onClick={() => setSelectedApt({ apt: r.apt, dong: r.dong, regionCode: r.regionCode })}>
                {r.apt}
                <small style={{ display: 'block', fontWeight: 400, color: PALETTE.textMuted }}>
                  {r.dong} · 표본 {r.volume}건{r.volume <= 2 && <span style={{ color: PALETTE.down }}> · 표본 적음</span>}
                </small>
              </span>
              <span>{fmtWon(r.latest)}</span>
              <b style={{ color: r.mom >= 0 ? PALETTE.up : PALETTE.down }}>{fmtPct(r.mom)}</b>
            </div>
          ))}
        </div>
      )}
      {analyticsView === 'volume' && (
        <div style={styles.card} className="ui-card">
          <h2 style={styles.sectionTitle}>거래량 상위 단지</h2>
          {advancedAnalytics.volumeLeaders.map((r, i) => (
            <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '42px 1fr 90px 90px', gap: 8, padding: '11px 0', borderBottom: `1px solid ${PALETTE.border}` }}>
              <b>{i + 1}</b>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{r.apt}<small style={{ display: 'block', fontWeight: 400, color: PALETTE.textMuted }}>{r.dong}</small></span>
              <span>{r.volume}건</span>
              <span>{fmtWon(r.latest)}</span>
            </div>
          ))}
        </div>
      )}
      {analyticsView === 'distribution' && (() => {
        const vals = advancedAnalytics.rows.map((r) => r.latest).filter((v) => Number.isFinite(v));
        if (!vals.length) return <div style={styles.card} className="ui-card">가격분포를 계산할 데이터가 없습니다.</div>;
        const min = Math.floor(Math.min(...vals) / 10000) * 10000;
        const max = Math.ceil(Math.max(...vals) / 10000) * 10000;
        const step = 10000;
        const bins = [];
        for (let lo = min; lo <= max; lo += step) {
          const hi = lo + step;
          bins.push({ label: `${(lo / 10000).toFixed(0)}억`, count: vals.filter((v) => v >= lo && v < hi).length });
        }
        const top = Math.max(...bins.map((b) => b.count), 1);
        return (
          <div style={styles.card} className="ui-card">
            <h2 style={styles.sectionTitle}>최근 거래가격 분포</h2>
            <p style={{ fontSize: 11, color: PALETTE.textMuted }}>현재 조회된 단지의 최근 거래가격을 1억원 구간으로 나눠 분포를 보여줍니다.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: 8, alignItems: 'end' }}>
              {bins.map((b) => (
                <div key={b.label} style={{ textAlign: 'center' }}>
                  <div style={{ height: 110, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                    <div title={`${b.count}건`} style={{ width: '55%', height: `${Math.max(4, (b.count / top) * 100)}%`, background: PALETTE.accent, borderRadius: '5px 5px 0 0' }} />
                  </div>
                  <b style={{ fontSize: 11 }}>{b.label}</b>
                  <div style={{ fontSize: 10, color: PALETTE.textMuted }}>{b.count}개</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
      {analyticsView === 'highs' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={styles.card} className="ui-card">
            <h2 style={styles.sectionTitle}>신고가 후보</h2>
            <p style={{ fontSize: 10.5, color: PALETTE.textMuted, margin: '-4px 0 8px' }}>기간 내 마지막 거래가 그 단지의 가장 비쌌던 거래일 때예요. 표본이 적으면 우연일 수 있어요.</p>
            {advancedAnalytics.highs.map((r) => (
              <div key={r.key} style={{ padding: '10px 0', borderBottom: `1px solid ${PALETTE.border}` }}>
                <b>{r.apt}</b><span style={{ float: 'right', color: PALETTE.up }}>{fmtWon(r.latest)}</span>
                <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>
                  {r.dong} · 최고가 갱신 · 표본 {r.volume}건{r.volume <= 2 && <span style={{ color: PALETTE.down }}> · 표본 적음</span>}
                </div>
              </div>
            ))}
          </div>
          <div style={styles.card} className="ui-card">
            <h2 style={styles.sectionTitle}>고점 대비 하락폭</h2>
            <p style={{ fontSize: 10.5, color: PALETTE.textMuted, margin: '-4px 0 8px' }}>표본이 적으면 우연한 한두 건 차이일 수 있어요.</p>
            {advancedAnalytics.drawdowns.map((r) => (
              <div key={r.key} style={{ padding: '10px 0', borderBottom: `1px solid ${PALETTE.border}` }}>
                <b>{r.apt}</b><span style={{ float: 'right', color: PALETTE.down }}>{fmtPct(r.drawdown)}</span>
                <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>
                  {r.dong} · 현재 {fmtWon(r.latest)} / 고점 {fmtWon(r.high)} · 표본 {r.volume}건{r.volume <= 2 && <span style={{ color: PALETTE.down }}> · 표본 적음</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {analyticsView === 'signals' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ ...styles.card, display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 10 }} className="ui-card">
            {[['최근 거래량', `${marketSignals.recent.toLocaleString()}건`], ['이전 구간', `${marketSignals.prev.toLocaleString()}건`], ['거래량 변화', fmtPct(marketSignals.volumeChange)], ['가격 중앙값', fmtWon(marketSignals.median)]].map(([label, value]) => (
              <div key={label} style={{ padding: 12, background: PALETTE.panelAlt, borderRadius: 8 }}><div style={styles.kpiLabel}>{label}</div><div style={{ fontSize: 18, fontWeight: 800 }}>{value}</div></div>
            ))}
          </div>
          <div style={{ ...styles.card, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }} className="ui-card">
            <div>
              <h2 style={styles.sectionTitle}>가격 분포 범위</h2>
              <p style={{ fontSize: 11, color: PALETTE.textMuted }}>조회기간 거래가격의 25~75 분위 범위입니다.</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 16 }}><b>25% {fmtWon(marketSignals.p25)}</b><b>중앙값 {fmtWon(marketSignals.median)}</b><b>75% {fmtWon(marketSignals.p75)}</b></div>
              <div style={{ height: 12, background: PALETTE.border, borderRadius: 8, marginTop: 8 }}><div style={{ width: '50%', margin: '0 auto', height: '100%', background: PALETTE.textPrimary, opacity: 0.18, borderRadius: 8 }} /></div>
            </div>
            <div>
              <h2 style={styles.sectionTitle}>최근 흐름</h2>
              <p style={{ fontSize: 11, color: PALETTE.textMuted }}>최근 구간과 이전 구간의 거래활동 및 최근 월 중앙가격 변화입니다.</p>
              <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>거래량 변화</span><b style={{ color: (marketSignals.volumeChange ?? 0) >= 0 ? PALETTE.up : PALETTE.down }}>{fmtPct(marketSignals.volumeChange)}</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>최근 월 중앙가격</span><b style={{ color: (marketSignals.monthlyPriceChange ?? 0) >= 0 ? PALETTE.up : PALETTE.down }}>{fmtPct(marketSignals.monthlyPriceChange)}</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>25~75 분위 스프레드</span><b>{fmtPct(marketSignals.spread)}</b></div>
              </div>
            </div>
          </div>
          <div style={styles.card} className="ui-card">
            <h2 style={styles.sectionTitle}>월별 중앙가격 · 거래량</h2>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={marketSignals.monthly.map((r) => ({ ...r, ym: monthLabel(r.ym), 중앙가격: r.median }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="ym" />
                <YAxis yAxisId="p" />
                <YAxis yAxisId="v" orientation="right" />
                <Tooltip />
                <Bar yAxisId="v" dataKey="count" fill={PALETTE.accent} opacity={0.25} />
                <Line yAxisId="p" type="monotone" dataKey="중앙가격" stroke={PALETTE.textPrimary} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div style={{ fontSize: 10.5, color: PALETTE.textMuted, marginTop: 12 }}>※ 모든 지표는 현재 화면에서 조회된 실거래를 기반으로 한 파생지표입니다. 면적·층·동일 평형 여부를 완전히 보정하지 않은 값은 참고용으로 표시합니다.</div>
    </div>
  );
}

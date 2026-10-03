import React from 'react';
import { X } from 'lucide-react';
import { REGION_GROUPS, SIDO_AGGREGATES } from '../lib/regions';
import {
  PALETTE, fmtPct, fmtManwon, fmtWon, labelFor,
} from '../lib/ui-helpers';

// 순위·통계 탭. app/page.jsx 안에 있던 viewMode === 'analytics' 블록을 그대로 옮긴 것.
export default function AnalyticsTab({
  comparePickerValue, addRegionAndFetch, selected, removeRegion, status,
  analyticsKpis, unitLabel,
  analyticsScope, setAnalyticsScope, analyticsMetric, setAnalyticsMetric,
  analyticsSorted, setSelectedApt,
  complexCompare, ladderBaseline, setLadderBaseline,
  styles,
}) {
  return (
    <div style={{ padding: '20px 20px 40px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 className="dash-title" style={{ ...styles.sectionTitle, fontSize: 26, marginBottom: 5 }}>순위·통계 분석</h1>
          <p style={{ fontSize: 12, color: PALETTE.textMuted, margin: 0 }}>현재 조회한 실거래 데이터를 기준으로 가격수준·변동률·거래량·가격범위를 비교합니다.</p>
        </div>
        <button className="ui-btn no-print" style={{ ...styles.btn, width: 'auto', padding: '8px 14px', fontSize: 12.5 }} onClick={() => window.print()}>
          📄 PDF로 내보내기
        </button>
      </div>
      <div style={{ ...styles.card, marginBottom: 14 }} className="ui-card no-print">
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 10, marginBottom: 14 }}>
        <div style={styles.card} className="ui-card"><div style={styles.kpiLabel}>분석 대상</div><div style={styles.kpiValue}>{analyticsKpis.count.toLocaleString()}개</div></div>
        <div style={styles.card} className="ui-card"><div style={styles.kpiLabel}>최근 평균 {unitLabel}</div><div style={styles.kpiValue}>{analyticsKpis.avg != null ? fmtWon(analyticsKpis.avg) : '-'}</div></div>
        <div style={styles.card} className="ui-card"><div style={styles.kpiLabel}>조회 거래량</div><div style={styles.kpiValue}>{analyticsKpis.volume.toLocaleString()}건</div></div>
        <div style={styles.card} className="ui-card"><div style={styles.kpiLabel}>변동률 중앙값</div><div style={styles.kpiValue}>{fmtPct(analyticsKpis.median)}</div></div>
      </div>
      <div style={{ ...styles.card, marginBottom: 14, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }} className="no-print">
        <div style={{ display: 'flex', gap: 6 }}>
          {[['region', '지역 분석'], ['complex', '단지 분석'], ['ladder', '가격 사다리']].map(([k, l]) => (
            <button key={k} className="portal-pill" style={{ background: analyticsScope === k ? PALETTE.textPrimary : PALETTE.panelAlt, color: analyticsScope === k ? '#fff' : PALETTE.textPrimary }} onClick={() => setAnalyticsScope(k)}>{l}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[['change', '기간 변동률'], ['price', '가격수준'], ['volume', '거래량'], ['range', '가격범위']].map(([k, l]) => (
            <button key={k} className="portal-pill" style={{ background: analyticsMetric === k ? PALETTE.accent : PALETTE.panelAlt, color: analyticsMetric === k ? '#fff' : PALETTE.textPrimary }} onClick={() => setAnalyticsMetric(k)}>{l}</button>
          ))}
        </div>
      </div>
      {analyticsScope !== 'ladder' && (
      <div style={styles.card} className="ui-card">
        <h2 style={styles.sectionTitle}>{analyticsScope === 'region' ? '지역별' : '단지별'} 분석 순위</h2>
        <p style={{ fontSize: 11, color: PALETTE.textMuted, margin: '-6px 0 12px' }}>선택한 지표를 기준으로 정렬한 수치 비교입니다.</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={styles.th}>순번</th>
                <th style={styles.th}>{analyticsScope === 'region' ? '지역' : '단지'}</th>
                <th style={styles.th}>최근 {unitLabel}</th>
                <th style={styles.th}>기간 변동률</th>
                <th style={styles.th}>거래량</th>
                <th style={styles.th}>최저 거래가</th>
                <th style={styles.th}>최고 거래가</th>
              </tr>
            </thead>
            <tbody>
              {analyticsSorted.map((r, i) => (
                <tr key={r.key}>
                  <td style={styles.td}>{i + 1}</td>
                  <td
                    style={{ ...styles.td, color: analyticsScope === 'complex' ? PALETTE.accent : PALETTE.textPrimary, cursor: analyticsScope === 'complex' ? 'pointer' : 'default' }}
                    onClick={() => analyticsScope === 'complex' && setSelectedApt({ apt: r.apt, dong: r.dong, regionCode: r.regionCode })}
                  >
                    {r.name}
                    {r.sub && <div style={{ fontSize: 10, color: PALETTE.textMuted }}>{r.sub}</div>}
                  </td>
                  <td style={styles.td}>{r.latest != null ? fmtWon(r.latest) : '-'}</td>
                  <td style={{ ...styles.td, color: r.change > 0 ? PALETTE.up : r.change < 0 ? PALETTE.down : PALETTE.textSecondary }}>{fmtPct(r.change)}</td>
                  <td style={styles.td}>{r.volume.toLocaleString()}건</td>
                  <td style={styles.td}>{r.min != null ? fmtManwon(r.min) : '-'}</td>
                  <td style={styles.td}>{r.max != null ? fmtManwon(r.max) : '-'}</td>
                </tr>
              ))}
              {analyticsSorted.length === 0 && (
                <tr><td style={styles.td} colSpan={7}>분석할 데이터가 없습니다. 먼저 지역을 선택하고 조회해주세요.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
      {analyticsScope === 'ladder' && (
        <div style={styles.card} className="ui-card">
          <h2 style={styles.sectionTitle}>가격 사다리</h2>
          <p style={{ fontSize: 11, color: PALETTE.textMuted, margin: '-6px 0 12px' }}>
            현재 조회된 단지를 평당가 순으로 늘어놓았어요. 하나를 클릭하면 다른 단지들이 그 단지보다 얼마나 비싸거나 저렴한지 보여줘요.
          </p>
          <div style={{ maxHeight: 560, overflowY: 'auto' }}>
            {[...complexCompare].sort((a, b) => b.unitPrice - a.unitPrice).map((c) => {
              const key = `${c.regionCode}|${c.dong}|${c.apt}`;
              const baseline = ladderBaseline ? complexCompare.find((x) => `${x.regionCode}|${x.dong}|${x.apt}` === ladderBaseline) : null;
              const diff = baseline ? c.unitPrice - baseline.unitPrice : null;
              const isBaseline = key === ladderBaseline;
              return (
                <div
                  key={key}
                  onClick={() => setLadderBaseline(isBaseline ? null : key)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                    padding: '9px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 4,
                    background: isBaseline ? 'rgba(239,68,68,0.10)' : 'transparent',
                    border: `1px solid ${isBaseline ? PALETTE.accent : 'transparent'}`,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700 }}>{c.apt}</span>
                    <span style={{ fontSize: 10.5, color: PALETTE.textMuted, marginLeft: 6 }}>{labelFor(c.regionCode)} {c.dong}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    {diff != null && !isBaseline && (
                      <span style={{ fontSize: 11, color: diff > 0 ? PALETTE.up : diff < 0 ? PALETTE.down : PALETTE.textMuted }}>
                        {diff > 0 ? '+' : ''}{fmtManwon(Math.round(diff))}/평
                      </span>
                    )}
                    <b style={{ fontSize: 13 }}>{fmtManwon(Math.round(c.unitPrice))}/평</b>
                  </div>
                </div>
              );
            })}
            {complexCompare.length === 0 && (
              <p style={{ fontSize: 12, color: PALETTE.textMuted }}>비교할 단지가 없어요. 지역을 선택해보세요.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

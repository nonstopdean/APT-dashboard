import React from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { X } from 'lucide-react';
import { REGION_GROUPS, SIDO_AGGREGATES } from '../lib/regions';
import {
  PALETTE, LINE_COLORS, fmtPct, fmtArea, fmtManwon, fmtWon, labelFor,
} from '../lib/ui-helpers';

// 비교분석 탭. app/page.jsx 안에 있던 viewMode === 'compare' 블록을 그대로 옮긴 것으로,
// 로직은 바꾸지 않았다.
export default function CompareTab({
  pinnedComplexes, setPinnedComplexes, complexCompare, setSelectedApt, isRent,
  comparePickerValue, addRegionAndFetch, status,
  compareAKey, setCompareAKey, compareBKey, setCompareBKey, compareCKey, setCompareCKey,
  compareOptions, compareAResult, compareBResult, compareCResult,
  compareChartData, compareBarData, compareResultsList,
  styles,
}) {
  return (
    <div style={{ padding: '20px 20px 0' }}>
      {pinnedComplexes.length > 0 && (
        <div style={{ ...styles.card, marginBottom: 16 }} className="ui-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <h2 style={{ ...styles.sectionTitle, margin: 0 }}>단지 비교 ({pinnedComplexes.length}/5)</h2>
            <button className="ui-btn" style={{ ...styles.btn, width: 'auto', padding: '5px 10px', fontSize: 11 }} onClick={() => setPinnedComplexes([])}>전체 비우기</button>
          </div>
          <p style={{ fontSize: 11, color: PALETTE.textMuted, margin: '4px 0 12px' }}>
            단지 상세 화면의 "📊 단지 비교에 추가"로 담은 단지들이에요. 현재 조회된 실거래 기준이라 평형이 섞여 있을 수 있어요.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={styles.th}>단지</th>
                  <th style={styles.th}>최근가</th>
                  <th style={styles.th}>평당가</th>
                  <th style={styles.th}>변동률</th>
                  <th style={styles.th}>거래량</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {pinnedComplexes.map((p) => {
                  const row = complexCompare.find((c) => c.apt === p.apt && c.dong === p.dong && c.regionCode === p.regionCode);
                  return (
                    <tr key={`${p.regionCode}|${p.dong}|${p.apt}`}>
                      <td style={{ ...styles.td, color: PALETTE.accent, cursor: 'pointer' }} onClick={() => setSelectedApt(p)}>
                        {p.apt}<div style={{ fontSize: 10, color: PALETTE.textMuted }}>{labelFor(p.regionCode)} {p.dong}</div>
                      </td>
                      <td style={styles.td}>{row ? fmtManwon(isRent ? row.deposit : row.amount) : '-'}</td>
                      <td style={styles.td}>{row?.unitPrice != null ? fmtManwon(Math.round(row.unitPrice)) : '-'}</td>
                      <td style={{ ...styles.td, color: row?.change > 0 ? PALETTE.up : row?.change < 0 ? PALETTE.down : PALETTE.textPrimary }}>{row ? fmtPct(row.change) : '-'}</td>
                      <td style={styles.td}>{row ? `${row.count}건` : '조회된 실거래 없음'}</td>
                      <td style={styles.td}>
                        <X size={13} style={{ cursor: 'pointer', color: PALETTE.textMuted }} onClick={() => setPinnedComplexes((prev) => prev.filter((x) => !(x.apt === p.apt && x.dong === p.dong && x.regionCode === p.regionCode)))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div style={styles.card} className="ui-card">
        <h2 style={styles.sectionTitle}>비교분석</h2>
        <p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: '-6px 0 14px' }}>
          지역이나 단지를 최대 3개까지 골라서 {isRent ? '전세보증금' : '매매가'} 평당가 추이를 나란히 비교해요.
        </p>

        <div style={{ marginBottom: 16 }}>
          <label style={styles.label}>비교할 지역 새로 추가 (여기서 바로 불러옵니다)</label>
          <select
            value={comparePickerValue}
            onChange={(e) => addRegionAndFetch(e.target.value)}
            style={{ ...styles.select, fontSize: 13 }}
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
          {status === 'loading' && (
            <p style={{ fontSize: 11.5, color: PALETTE.textMuted, marginTop: 4 }}>불러오는 중...</p>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
          {[
            { key: compareAKey, set: setCompareAKey, label: 'A' },
            { key: compareBKey, set: setCompareBKey, label: 'B' },
            { key: compareCKey, set: setCompareCKey, label: 'C' },
          ].map((slot) => (
            <div key={slot.label}>
              <label style={styles.label}>비교 대상 {slot.label}</label>
              <select
                value={slot.key}
                onChange={(e) => slot.set(e.target.value)}
                style={{ ...styles.select, fontSize: 13 }}
              >
                <option value="">선택 안 함</option>
                <optgroup label="지역">
                  {compareOptions.filter((o) => o.kind === 'region').map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </optgroup>
                <optgroup label="단지">
                  {compareOptions.filter((o) => o.kind === 'apt').map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          ))}
        </div>

        {compareOptions.length === 0 && (
          <p style={{ fontSize: 12.5, color: PALETTE.textMuted }}>
            위에서 지역을 하나 추가해보세요. 불러온 지역과 그 안의 단지들이 비교 대상 선택지로 나와요.
          </p>
        )}

        {(compareAKey || compareBKey || compareCKey) && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
              {[
                { result: compareAResult, label: 'A' },
                { result: compareBResult, label: 'B' },
                { result: compareCResult, label: 'C' },
              ].map((slot) => (
                <div key={slot.label} style={{ ...styles.card, borderStyle: 'dashed' }}>
                  <div style={styles.kpiLabel}>{slot.label} 기간 등락률</div>
                  <div style={{ ...styles.kpiValue, fontSize: 18, color: slot.result.changePct > 0 ? PALETTE.up : slot.result.changePct < 0 ? PALETTE.down : PALETTE.textPrimary }}>
                    {slot.result.label ? fmtPct(slot.result.changePct) : '-'}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ width: '100%', height: 300, marginBottom: 20 }}>
              <ResponsiveContainer>
                <LineChart data={compareChartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={PALETTE.border} vertical={false} />
                  <XAxis dataKey="ym" stroke={PALETTE.textMuted} fontSize={11} tickLine={false} />
                  <YAxis stroke={PALETTE.textMuted} fontSize={11} tickLine={false} width={48} />
                  <Tooltip contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                    labelStyle={{ color: PALETTE.textPrimary }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {[compareAResult, compareBResult, compareCResult].map((r, i) => (
                    r.label && (
                      <Line key={r.label} type="monotone" dataKey={r.label} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                    )
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <h3 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px', color: PALETTE.textPrimary }}>
              최근 평당가 비교 (만원)
            </h3>
            <div style={{ width: '100%', height: 200, marginBottom: 20 }}>
              <ResponsiveContainer>
                <BarChart data={compareBarData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={PALETTE.border} vertical={false} />
                  <XAxis dataKey="name" stroke={PALETTE.textMuted} fontSize={11} tickLine={false} />
                  <YAxis stroke={PALETTE.textMuted} fontSize={11} tickLine={false} width={48} />
                  <Tooltip contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                    labelStyle={{ color: PALETTE.textPrimary }} />
                  <Bar dataKey="평당가" radius={[4, 4, 0, 0]}>
                    {compareBarData.map((_, i) => <Cell key={i} fill={LINE_COLORS[i % LINE_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <h3 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px', color: PALETTE.textPrimary }}>
              요약 비교표
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={styles.th}>대상</th>
                    <th style={styles.th}>최근 평당가</th>
                    <th style={styles.th}>기간 등락률</th>
                    <th style={styles.th}>최고가</th>
                    <th style={styles.th}>최저가</th>
                    <th style={styles.th}>평균 전용면적</th>
                    <th style={styles.th}>거래건수</th>
                  </tr>
                </thead>
                <tbody>
                  {compareResultsList.map((r) => (
                    <tr key={r.label}>
                      <td style={styles.td}>{r.label}</td>
                      <td style={styles.td}>{r.latest != null ? fmtWon(r.latest) : '-'}</td>
                      <td style={{ ...styles.td, color: r.changePct > 0 ? PALETTE.up : r.changePct < 0 ? PALETTE.down : PALETTE.textPrimary }}>
                        {fmtPct(r.changePct)}
                      </td>
                      <td style={styles.td}>{fmtManwon(r.max)}</td>
                      <td style={styles.td}>{fmtManwon(r.min)}</td>
                      <td style={styles.td}>{fmtArea(r.avgArea)}</td>
                      <td style={styles.td}>{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

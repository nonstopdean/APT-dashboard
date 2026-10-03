import React from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { PALETTE, SIDO_SHORT_NAMES } from '../lib/ui-helpers';

// 분양(청약) 정보 탭. app/page.jsx 안에 있던 viewMode === 'subscriptions' 블록을 그대로 옮긴 것.
export default function SubscriptionsTab({
  subsTabSido, setSubsTabSido, subsSubView, setSubsSubView,
  subsTabLoading, subsTabRows, supplyByMonth,
  styles,
}) {
  return (
    <div style={{ padding: '20px 20px 0' }}>
      <div style={styles.card} className="ui-card">
        <h2 style={styles.sectionTitle}>분양(청약) 정보</h2>
        <p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: '-6px 0 14px' }}>
          한국부동산원 청약홈 기준, 최근 1년 내 아파트 모집공고예요. 지역을 골라서 확인하세요.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ maxWidth: 220, flex: 1, minWidth: 160 }}>
            <select
              value={subsTabSido}
              onChange={(e) => setSubsTabSido(e.target.value)}
              style={{ ...styles.select, fontSize: 13 }}
            >
              {SIDO_SHORT_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={styles.toggleBtn(subsSubView === 'list')} onClick={() => setSubsSubView('list')}>분양공고 목록</div>
            <div style={styles.toggleBtn(subsSubView === 'supply')} onClick={() => setSubsSubView('supply')}>입주물량(공급)</div>
          </div>
        </div>
        {subsTabLoading && (
          <p style={{ fontSize: 12, color: PALETTE.textMuted }}>불러오는 중...</p>
        )}
        {!subsTabLoading && subsTabRows.length === 0 && (
          <p style={{ fontSize: 12, color: PALETTE.textMuted }}>최근 1년 내 모집공고가 없어요.</p>
        )}
        {subsSubView === 'supply' && subsTabRows.length > 0 && (
          <>
            <p style={{ fontSize: 11, color: PALETTE.textMuted, margin: '-6px 0 12px' }}>
              {subsTabSido} 지역, 입주예정월 기준 신규 공급 세대수예요. 아파트 청약 공고에 나온 세대수만 반영돼요.
            </p>
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={supplyByMonth} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={PALETTE.border} vertical={false} />
                  <XAxis dataKey="ym" stroke={PALETTE.textMuted} fontSize={11} tickLine={false} />
                  <YAxis stroke={PALETTE.textMuted} fontSize={11} tickLine={false} width={44} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                    labelStyle={{ color: PALETTE.textPrimary }}
                    formatter={(v) => `${v.toLocaleString()}세대`} />
                  <Bar dataKey="세대수" fill={PALETTE.accent} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
        {subsSubView === 'list' && subsTabRows.length > 0 && (
          <div style={{ maxHeight: 520, overflowY: 'auto', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={styles.th}>주택명</th>
                  <th style={styles.th}>위치</th>
                  <th style={styles.th}>공급규모</th>
                  <th style={styles.th}>모집공고일</th>
                  <th style={styles.th}>청약접수</th>
                  <th style={styles.th}>입주예정</th>
                  <th style={styles.th}>시공사</th>
                  <th style={styles.th}>규제</th>
                </tr>
              </thead>
              <tbody>
                {subsTabRows.map((s, i) => (
                  <tr key={i}>
                    <td style={styles.td}>
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer" style={{ color: PALETTE.accent }}>{s.houseName}</a>
                      ) : s.houseName}
                    </td>
                    <td style={styles.td}>{s.address}</td>
                    <td style={styles.td}>{s.totalUnits}세대</td>
                    <td style={styles.td}>{s.announceDate}</td>
                    <td style={styles.td}>{s.receiptStart} ~ {s.receiptEnd}</td>
                    <td style={styles.td}>{s.moveInMonth}</td>
                    <td style={styles.td}>{s.builder}</td>
                    <td style={styles.td}>
                      {(s.isSpeculationOverheated || s.isAdjustmentTarget) && (
                        <span style={{ ...styles.chip, padding: '2px 8px', fontSize: 11 }}>규제</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

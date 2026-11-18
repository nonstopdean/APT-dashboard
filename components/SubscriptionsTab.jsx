import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import { PALETTE, SIDO_SHORT_NAMES, fmtYm, TD_WRAP } from '../lib/ui-helpers';
import { moveInByRegion, moveInYearTable, moveInMonthly } from '../lib/move-in-supply';

// v231: 입주 물량 기간. 이번 달부터 앞으로 N개월, 또는 지난 12개월.
const SUPPLY_PERIODS = [['next12', '앞으로 1년'], ['next24', '앞으로 2년'], ['next36', '앞으로 3년'], ['past12', '지난 1년']];
const ymOf = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
const shiftYm = (ym, n) => ymOf(new Date(Number(ym.slice(0, 4)), Number(ym.slice(4, 6)) - 1 + n, 1));

// 분양(청약) 정보 탭. app/page.jsx 안에 있던 viewMode === 'subscriptions' 블록을 그대로 옮긴 것.
export default function SubscriptionsTab({
  subsTabSido, setSubsTabSido, subsSubView, setSubsSubView,
  subsTabLoading, subsTabRows,
  styles,
}) {
  // v231: 구별 입주 물량 — "입주물량" 화면을 열 때만 그 시·도의 최근 5년 공고를 전부 받는다(공고 후 2~3년 뒤 입주라서).
  const [supply, setSupply] = useState({ sido: '', rows: [], loading: false, error: '', truncated: false });
  const supplyCacheRef = useRef({});
  const [period, setPeriod] = useState('next24');
  const [pickedCode, setPickedCode] = useState(null);
  useEffect(() => {
    if (subsSubView !== 'supply') return undefined;
    setPickedCode(null);
    const cached = supplyCacheRef.current[subsTabSido];
    if (cached) { setSupply(cached); return undefined; }
    let cancelled = false;
    setSupply({ sido: subsTabSido, rows: [], loading: true, error: '', truncated: false });
    const from = `${new Date().getFullYear() - 5}-01-01`;
    fetch(`/api/subscriptions?sido=${encodeURIComponent(subsTabSido)}&from=${from}&all=1`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const next = { sido: subsTabSido, rows: json?.rows || [], loading: false, error: json?.error || '', truncated: !!json?.truncated };
        if (!json?.error) supplyCacheRef.current[subsTabSido] = next;
        setSupply(next);
      })
      .catch(() => { if (!cancelled) setSupply({ sido: subsTabSido, rows: [], loading: false, error: '입주 물량 자료를 불러오지 못했어요.', truncated: false }); });
    return () => { cancelled = true; };
  }, [subsSubView, subsTabSido]);

  const thisYm = ymOf(new Date());
  const [fromYm, toYm] = period === 'past12' ? [shiftYm(thisYm, -12), shiftYm(thisYm, -1)]
    : [thisYm, shiftYm(thisYm, Number(period.slice(4)) - 1)];
  const groups = useMemo(() => moveInByRegion(supply.rows, fromYm, toYm), [supply.rows, fromYm, toYm]);
  const totalUnits = groups.reduce((s, g) => s + g.units, 0);
  const thisYear = new Date().getFullYear();
  const years = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2, thisYear + 3];
  const yearTable = useMemo(() => moveInYearTable(supply.rows, years), [supply.rows, thisYear]); // eslint-disable-line react-hooks/exhaustive-deps
  const yearMax = Math.max(1, ...yearTable.flatMap((r) => years.map((y) => r.byYear[y])));
  const monthly = useMemo(() => moveInMonthly(supply.rows, fromYm, toYm, pickedCode), [supply.rows, fromYm, toYm, pickedCode]);
  const picked = pickedCode ? groups.find((g) => g.code === pickedCode) : null;
  const barData = groups.slice(0, 25).map((g) => ({ code: g.code, name: g.name, 세대수: g.units, 단지: g.count }));

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
        {subsSubView === 'list' && subsTabLoading && (
          <p style={{ fontSize: 12, color: PALETTE.textMuted }}>불러오는 중...</p>
        )}
        {subsSubView === 'list' && !subsTabLoading && subsTabRows.length === 0 && (
          <p style={{ fontSize: 12, color: PALETTE.textMuted }}>최근 1년 내 모집공고가 없어요.</p>
        )}
        {subsSubView === 'supply' && (
          <>
            <p style={{ fontSize: 11, color: PALETTE.textMuted, margin: '-6px 0 10px', lineHeight: 1.5 }}>
              {subsTabSido}의 구·시별 입주 물량(입주예정월 기준)이에요. 최근 5년 청약홈 아파트 분양 공고의 공급 세대수를 모았어요.
              재건축·재개발 조합원 물량이나 공고 없이 들어오는 임대 세대는 빠져서 실제 입주 세대보다 적을 수 있어요.
            </p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {SUPPLY_PERIODS.map(([k, l]) => (
                <div key={k} style={{ ...styles.toggleBtn(period === k), padding: '6px 12px', fontSize: 12 }} onClick={() => { setPeriod(k); setPickedCode(null); }}>{l}</div>
              ))}
            </div>
            {supply.loading && <p style={{ fontSize: 12, color: PALETTE.textMuted }}>입주 물량 불러오는 중… (공고가 많은 곳은 10초쯤 걸려요)</p>}
            {!supply.loading && supply.error && <p style={{ fontSize: 12, color: '#B23A2E' }}>{supply.error}</p>}
            {!supply.loading && !supply.error && supply.sido === subsTabSido && (
              <>
                <div style={{ fontSize: 12.5, marginBottom: 8 }}>
                  <b>{fmtYm(fromYm)} ~ {fmtYm(toYm)}</b> 입주 예정 <b style={{ color: PALETTE.accent }}>{totalUnits.toLocaleString()}세대</b>
                  <span style={{ color: PALETTE.textMuted }}> · 공고 {groups.reduce((s, g) => s + g.count, 0)}건 · {groups.length}개 지역</span>
                  {supply.truncated && <span style={{ color: '#B23A2E' }}> · 공고가 너무 많아 일부만 반영</span>}
                </div>
                {barData.length === 0 ? (
                  <p style={{ fontSize: 12, color: PALETTE.textMuted }}>이 기간에 입주 예정인 공고가 없어요.</p>
                ) : (
                  <>
                    <div style={{ fontSize: 11, color: PALETTE.textMuted, marginBottom: 4 }}>막대를 누르면 그 지역의 월별 물량과 단지가 나와요.</div>
                    <div style={{ width: '100%', height: Math.max(140, barData.length * 26 + 30) }}>
                      <ResponsiveContainer>
                        <BarChart data={barData} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 0 }}
                          onClick={(e) => { const c = e?.activePayload?.[0]?.payload?.code; if (c) setPickedCode((p) => (p === c ? null : c)); }}>
                          <CartesianGrid stroke={PALETTE.border} horizontal={false} />
                          <XAxis type="number" stroke={PALETTE.textMuted} fontSize={11} tickLine={false} allowDecimals={false} />
                          <YAxis type="category" dataKey="name" stroke={PALETTE.textMuted} fontSize={11.5} tickLine={false} width={104} interval={0} />
                          <Tooltip contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                            formatter={(v, k, item) => [`${v.toLocaleString()}세대 (공고 ${item?.payload?.단지}건)`, '입주 예정']} />
                          <Bar dataKey="세대수" radius={[0, 4, 4, 0]} cursor="pointer"
                            label={{ position: 'right', fontSize: 10.5, fill: PALETTE.textSecondary, formatter: (v) => v.toLocaleString() }}>
                            {barData.map((d) => <Cell key={d.code} fill={!pickedCode || pickedCode === d.code ? PALETTE.accent : '#E9B7B0'} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    {groups.length > barData.length && (
                      <div style={{ fontSize: 11, color: PALETTE.textMuted }}>그 밖의 {groups.length - barData.length}개 지역은 아래 연도별 표에서 볼 수 있어요.</div>
                    )}
                  </>
                )}

                <h3 style={{ fontSize: 13, margin: '18px 0 6px' }}>
                  {picked ? `${picked.name} 월별 입주 물량` : `${subsTabSido} 전체 월별 입주 물량`}
                  {picked && <span style={{ marginLeft: 8, fontSize: 11, color: PALETTE.accent, cursor: 'pointer', fontWeight: 400 }} onClick={() => setPickedCode(null)}>전체 보기</span>}
                </h3>
                <div style={{ width: '100%', height: 220 }}>
                  <ResponsiveContainer>
                    <BarChart data={monthly} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={PALETTE.border} vertical={false} />
                      <XAxis dataKey="label" stroke={PALETTE.textMuted} fontSize={10.5} tickLine={false} interval="preserveStartEnd" />
                      <YAxis stroke={PALETTE.textMuted} fontSize={11} tickLine={false} width={44} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                        formatter={(v) => [`${v.toLocaleString()}세대`, '입주 예정']} />
                      <Bar dataKey="세대수" fill={PALETTE.accent} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {picked && (
                  <div style={{ marginTop: 10, maxHeight: 260, overflowY: 'auto', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={styles.th}>입주예정</th>
                          <th style={styles.th}>주택명</th>
                          <th style={styles.th}>세대수</th>
                          <th style={styles.th}>위치</th>
                        </tr>
                      </thead>
                      <tbody>
                        {picked.items.map((it, i) => (
                          <tr key={i}>
                            <td style={styles.td}>{fmtYm(it.moveInYm)}</td>
                            <td style={{ ...styles.td, ...TD_WRAP }}>
                              {it.url ? <a href={it.url} target="_blank" rel="noreferrer" style={{ color: PALETTE.accent }}>{it.houseName}</a> : it.houseName}
                            </td>
                            <td style={styles.td}>{it.units.toLocaleString()}</td>
                            <td style={{ ...styles.td, ...TD_WRAP, maxWidth: 280 }}>{it.address}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <h3 style={{ fontSize: 13, margin: '18px 0 6px' }}>연도별 입주 물량 (세대)</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={styles.th}>지역</th>
                        {years.map((y) => <th key={y} style={{ ...styles.th, textAlign: 'right' }}>{y}{y === thisYear ? ' (올해)' : ''}</th>)}
                        <th style={{ ...styles.th, textAlign: 'right' }}>합계</th>
                      </tr>
                    </thead>
                    <tbody>
                      {yearTable.map((r) => (
                        <tr key={r.code} onClick={() => { if (groups.some((g) => g.code === r.code)) setPickedCode(r.code); }}
                          style={{ cursor: groups.some((g) => g.code === r.code) ? 'pointer' : 'default', background: pickedCode === r.code ? PALETTE.accentSoft : undefined }}>
                          <td style={{ ...styles.td, fontWeight: 700 }}>{r.name}</td>
                          {years.map((y) => {
                            const v = r.byYear[y];
                            const a = v ? 0.08 + 0.5 * (v / yearMax) : 0;
                            return (
                              <td key={y} style={{ ...styles.td, textAlign: 'right', background: v ? `rgba(37,99,235,${a.toFixed(2)})` : undefined, color: v ? PALETTE.textPrimary : PALETTE.textMuted }}>
                                {v ? v.toLocaleString() : '-'}
                              </td>
                            );
                          })}
                          <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{r.total.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
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
                    <td style={{ ...styles.td, ...TD_WRAP }}>
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer" style={{ color: PALETTE.accent }}>{s.houseName}</a>
                      ) : s.houseName}
                    </td>
                    <td style={{ ...styles.td, ...TD_WRAP, maxWidth: 280 }}>{s.address}</td>
                    <td style={styles.td}>{s.totalUnits}세대</td>
                    <td style={styles.td}>{s.announceDate}</td>
                    <td style={styles.td}>{s.receiptStart} ~ {s.receiptEnd}</td>
                    <td style={styles.td}>{fmtYm(s.moveInMonth)}</td>
                    <td style={{ ...styles.td, ...TD_WRAP }}>{s.builder}</td>
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

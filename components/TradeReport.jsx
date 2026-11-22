'use client';

import React, { useMemo, useState } from 'react';
import {
  PALETTE, fmtPct, fmtWon, fmtManwon, labelFor,
} from '../lib/ui-helpers';
import { supplyPyeong } from '../lib/pyeong';
import { priceValueOf, unitValueOf } from '../lib/market-compare';
import {
  latestDay, recentTrades, topTrades, newHighs, regionUnitChange, dayOf, fmtDay,
} from '../lib/trade-report';

// v249: 시장분석 "신고가·주요 거래" — 실거래 일일 리포트 블로그처럼 최근 N일 거래를 요약한다.
//  ① 한 줄 요약 ② 신고가(불러온 기간 안 최고가 경신) ③ 가격순 주요 거래 ④ 지역별 평당가 변동(최근 N일 vs 직전 N일).
// tx = 시장분석에 추가한 지역의 불러온 실거래 전체(page.jsx allTx).

const pill = (on) => ({
  border: 'none', borderRadius: 999, padding: '6px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
  background: on ? PALETTE.accent : PALETTE.accentSoft, color: on ? '#fff' : PALETTE.accentDark, fontWeight: 700,
});
const tag = { display: 'inline-block', fontSize: 10, fontWeight: 700, color: '#fff', background: PALETTE.up, borderRadius: 4, padding: '1px 5px', marginLeft: 4, verticalAlign: 'middle' };
const ymd = (t) => `${t.year}.${String(t.month).padStart(2, '0')}.${String(t.day).padStart(2, '0')}`;

function TradeRow({ t, isRent, extra, high, onOpen, styles, rank }) {
  return (
    <tr>
      {rank != null && <td style={{ ...styles.td, fontWeight: 800, color: PALETTE.textMuted, width: 28 }}>{rank}</td>}
      <td style={styles.td}>
        <span style={{ fontSize: 11, color: PALETTE.textMuted }}>{labelFor(t.regionCode)}</span>
        <div style={{ cursor: 'pointer', fontWeight: 700, color: PALETTE.accentDark }} onClick={onOpen}>
          {t.apt}{high && <span style={tag}>신고가</span>}
        </div>
        <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>{t.dong}{t.buildYear ? ` · ${t.buildYear}년` : ''}</div>
      </td>
      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
        {Math.round(t.area)}㎡({supplyPyeong(t.area)}평)
        <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>{t.floor}층 · {ymd(t)}</div>
      </td>
      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
        <b style={{ fontSize: 13.5 }}>{fmtWon(priceValueOf(t, isRent))}</b>
        <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>평당 {unitValueOf(t, isRent) ? fmtManwon(Math.round(unitValueOf(t, isRent))) : '-'}</div>
        {extra}
      </td>
    </tr>
  );
}

export default function TradeReport({ tx, isRent, setSelectedApt, styles }) {
  const [days, setDays] = useState(30);
  const [highLimit, setHighLimit] = useState(15);
  const ref = useMemo(() => latestDay(tx), [tx]);
  const firstDay = useMemo(() => (tx || []).reduce((m, t) => { const d = dayOf(t); return m == null || d < m ? d : m; }, null), [tx]);
  const recent = useMemo(() => recentTrades(tx, days, ref), [tx, days, ref]);
  const highs = useMemo(() => newHighs(tx, isRent, { days, ref }), [tx, isRent, days, ref]);
  const tops = useMemo(() => topTrades(tx, isRent, { days, ref, limit: 20 }), [tx, isRent, days, ref]);
  const changes = useMemo(() => regionUnitChange(tx, isRent, { days, ref }), [tx, isRent, days, ref]);
  const highKeys = useMemo(() => new Set(highs.map((h) => h.t)), [highs]);
  const open = (t) => () => setSelectedApt({ apt: t.apt, dong: t.dong, regionCode: t.regionCode });

  if (!tx || !tx.length) {
    return <div style={styles.card} className="ui-card"><p style={{ fontSize: 13, color: PALETTE.textMuted, margin: 0 }}>위에서 지역을 추가하면 리포트가 나와요.</p></div>;
  }
  const kind = isRent ? '전세' : '매매';
  const top = tops[0];
  const topHighRegion = (() => {
    const m = new Map();
    highs.forEach((h) => m.set(h.t.regionCode, (m.get(h.t.regionCode) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  })();
  const up = changes[0]; const down = changes[changes.length - 1];

  return (
    <div style={{ display: 'grid', gap: 12 }} data-trade-report="1">
      <div style={styles.card} className="ui-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <h2 style={{ ...styles.sectionTitle, margin: 0 }}>실거래 리포트</h2>
          <span style={{ fontSize: 11.5, color: PALETTE.textMuted }}>계약일 기준 · {fmtDay(ref)}까지 신고된 자료</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {[7, 30].map((d) => <button key={d} type="button" data-report-days={d} style={pill(days === d)} onClick={() => setDays(d)}>최근 {d}일</button>)}
          </div>
        </div>
        {/* 한 줄 요약(블로그 첫 문단처럼) */}
        <p data-report-summary="1" style={{ fontSize: 13.5, lineHeight: 1.75, margin: 0, color: PALETTE.textPrimary }}>
          최근 {days}일 동안 계약된 {kind}는 <b>{recent.length.toLocaleString()}건</b>이에요.
          {' '}그중 같은 단지·같은 면적에서 이전 최고가를 넘긴 <b style={{ color: PALETTE.up }}>신고가는 {highs.length}건</b>
          {topHighRegion ? <>이고, <b>{labelFor(topHighRegion[0])}</b>에서 {topHighRegion[1]}건으로 가장 많았어요.</> : '이에요.'}
          {top && <>{' '}가장 비싼 거래는 <b>{labelFor(top.regionCode)} {top.apt}</b> 전용 {Math.round(top.area)}㎡ <b>{fmtWon(priceValueOf(top, isRent))}</b>이에요.</>}
          {up && down && up !== down && (
            <>{' '}평당가는 직전 {days}일보다 <b>{labelFor(up.code)}</b>에서 <b style={{ color: up.pct > 0 ? PALETTE.up : PALETTE.down }}>{fmtPct(up.pct)}</b>로 가장 많이 {up.pct > 0 ? '올랐고' : '덜 내렸고'}, <b>{labelFor(down.code)}</b>에서 <b style={{ color: down.pct < 0 ? PALETTE.down : PALETTE.up }}>{fmtPct(down.pct)}</b>로 가장 {down.pct < 0 ? '많이 내렸어요' : '적게 올랐어요'}.</>
          )}
        </p>
        <p style={{ fontSize: 10.5, color: PALETTE.textMuted, margin: '8px 0 0', lineHeight: 1.6 }}>
          신고 기한이 30일이라 최근 며칠 치는 아직 덜 신고됐을 수 있어요. 신고가는 불러온 기간({fmtDay(firstDay)}~) 안에서 같은 단지·같은 전용면적의 앞선 최고가와 비교했어요(2006년 이후 전체가 아니에요).
          대시보드 탭에서 조회 기간을 늘리면 더 오래된 최고가까지 비교해요.
        </p>
      </div>

      <div style={styles.card} className="ui-card">
        <h2 style={styles.sectionTitle}>🔺 신고가 {highs.length}건</h2>
        {highs.length === 0 ? (
          <p style={{ fontSize: 12.5, color: PALETTE.textMuted, margin: 0 }}>최근 {days}일에 이전 최고가를 넘긴 거래가 없어요.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }} data-report-table="highs">
              <thead><tr>{['단지', '전용·층', '거래가'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
              <tbody>
                {highs.slice(0, highLimit).map((h, i) => (
                  <TradeRow
                    key={i} t={h.t} isRent={isRent} high onOpen={open(h.t)} styles={styles}
                    extra={(
                      <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>
                        이전 최고 {fmtWon(h.prevMax)} ({fmtDay(h.prevDay)}) <b style={{ color: PALETTE.up }}>{fmtPct(h.risePct)}</b>
                      </div>
                    )}
                  />
                ))}
              </tbody>
            </table>
            {highs.length > highLimit && (
              <button type="button" onClick={() => setHighLimit((n) => n + 20)} style={{ ...pill(false), width: '100%', marginTop: 8, borderRadius: 10, padding: '9px 0' }}>
                더 보기 ({highs.length - highLimit}건 남음)
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
        <div style={styles.card} className="ui-card">
          <h2 style={styles.sectionTitle}>💰 가격순 주요 거래</h2>
          <p style={{ fontSize: 10.5, color: PALETTE.textMuted, margin: '-6px 0 8px' }}>최근 {days}일 · 같은 단지는 가장 비싼 1건만</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }} data-report-table="tops">
              <thead><tr>{['', '단지', '전용·층', '거래가'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
              <tbody>
                {tops.map((t, i) => <TradeRow key={i} rank={i + 1} t={t} isRent={isRent} high={highKeys.has(t)} onOpen={open(t)} styles={styles} />)}
              </tbody>
            </table>
          </div>
        </div>
        <div style={styles.card} className="ui-card">
          <h2 style={styles.sectionTitle}>📈 지역별 평당가 변동</h2>
          <p style={{ fontSize: 10.5, color: PALETTE.textMuted, margin: '-6px 0 8px' }}>최근 {days}일 vs 직전 {days}일 평균 평당가 · 양쪽 5건 이상인 지역만</p>
          {changes.length === 0 ? (
            <p style={{ fontSize: 12.5, color: PALETTE.textMuted, margin: 0 }}>비교할 만큼 거래가 있는 지역이 없어요. 지역을 더 추가하거나 기간을 30일로 바꿔 보세요.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }} data-report-table="changes">
              <thead><tr>{['지역', `최근 ${days}일`, '직전', '변동'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.code}>
                    <td style={{ ...styles.td, fontWeight: 700 }}>{labelFor(c.code)}</td>
                    <td style={styles.td}>{fmtManwon(Math.round(c.recentAvg))}<div style={{ fontSize: 10, color: PALETTE.textMuted }}>{c.nRecent}건</div></td>
                    <td style={styles.td}>{fmtManwon(Math.round(c.prevAvg))}<div style={{ fontSize: 10, color: PALETTE.textMuted }}>{c.nPrev}건</div></td>
                    <td style={{ ...styles.td, fontWeight: 800, color: c.pct > 0 ? PALETTE.up : c.pct < 0 ? PALETTE.down : PALETTE.textPrimary }}>{fmtPct(c.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={{ fontSize: 10, color: PALETTE.textMuted, margin: '8px 0 0' }}>그 기간에 어떤 단지가 거래됐는지에 따라 크게 흔들릴 수 있어요(같은 단지끼리 비교한 값이 아니에요).</p>
        </div>
      </div>
    </div>
  );
}

'use client';

import React, { useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import {
  PALETTE, fmtPct, fmtWon, fmtManwon, labelFor,
} from '../lib/ui-helpers';
import { supplyPyeong } from '../lib/pyeong';

// v250: 시장분석 "일일 신고" — 매일 아침 크론(app/api/daily-snapshot)이 저장한 수도권 리포트를 보여준다(블로그식).
// 지역 선택과 상관없이 수도권(서울·인천·경기) 전체. 새로 공개된 거래 = 그날 신고분.

const pill = (on) => ({
  border: 'none', borderRadius: 999, padding: '6px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
  background: on ? PALETTE.accent : PALETTE.accentSoft, color: on ? '#fff' : PALETTE.accentDark, fontWeight: 700,
});
const tag = { display: 'inline-block', fontSize: 10, fontWeight: 700, color: '#fff', background: PALETTE.up, borderRadius: 4, padding: '1px 5px', marginLeft: 4, verticalAlign: 'middle' };
const fmtDate = (d) => (d ? `${Number(String(d).slice(4, 6))}월 ${Number(String(d).slice(6, 8))}일` : '-');
const fmtD8 = (n) => { const s = String(n || ''); return s.length === 8 ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}` : '-'; };
const ymdOf = (t) => `${t.y}.${String(t.m).padStart(2, '0')}.${String(t.d).padStart(2, '0')}`;

function Row({ t, rank, high, onOpen, styles }) {
  return (
    <tr>
      {rank != null && <td style={{ ...styles.td, fontWeight: 800, color: PALETTE.textMuted, width: 28 }}>{rank}</td>}
      <td style={styles.td}>
        <span style={{ fontSize: 11, color: PALETTE.textMuted }}>{labelFor(t.c)}</span>
        <div style={{ cursor: 'pointer', fontWeight: 700, color: PALETTE.accentDark }} onClick={onOpen}>{t.a}{high && <span style={tag}>신고가</span>}</div>
        <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>{t.g}{t.by ? ` · ${t.by}년` : ''}</div>
      </td>
      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
        {Math.round(t.ar)}㎡({supplyPyeong(t.ar)}평)
        <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>{t.f}층 · 계약 {ymdOf(t)}</div>
      </td>
      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
        <b style={{ fontSize: 13.5 }}>{fmtWon(t.p)}</b>
        <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>평당 {t.u ? fmtManwon(t.u) : '-'}</div>
        {t.pm && <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>이전 최고 {fmtWon(t.pm)} ({fmtD8(t.pd)}) <b style={{ color: PALETTE.up }}>{fmtPct(((t.p - t.pm) / t.pm) * 100)}</b></div>}
      </td>
    </tr>
  );
}

export default function DailyReport({ setSelectedApt, styles }) {
  const [date, setDate] = useState('');
  const [data, setData] = useState({ loading: true, index: [], report: null, stats: [], error: '' });
  const [highLimit, setHighLimit] = useState(15);

  useEffect(() => {
    let cancelled = false;
    setData((d) => ({ ...d, loading: true }));
    fetch(`/api/daily-report${date ? `?date=${date}` : ''}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setData({ loading: false, index: j.index || [], report: j.report || null, stats: Array.isArray(j.stats) ? j.stats : [], backfillNow: j.backfill || null, error: j.error || '' }); })
      .catch(() => { if (!cancelled) setData({ loading: false, index: [], report: null, stats: [], error: '불러오지 못했어요.' }); });
    return () => { cancelled = true; };
  }, [date]);

  const r = data.report;
  const open = (t) => () => setSelectedApt({ apt: t.a, dong: t.g, regionCode: t.c });
  const highSet = new Set((r?.highs || []).map((h) => `${h.c}|${h.a}|${h.ar}|${h.f}|${h.y}${h.m}${h.d}|${h.p}`));
  const isHigh = (t) => highSet.has(`${t.c}|${t.a}|${t.ar}|${t.f}|${t.y}${t.m}${t.d}|${t.p}`);
  const tops = r ? r.trades.slice(0, 20) : [];
  const topHigh = r ? [...(r.byRegion || [])].filter((g) => g.h > 0).sort((a, b) => b.h - a.h)[0] : null;
  // v257: 날짜별 추이(최근 30일, 오래된 날부터)
  const series = [...(data.stats || [])].slice(0, 30).reverse().map((s) => ({
    day: `${Number(String(s.d).slice(4, 6))}/${Number(String(s.d).slice(6, 8))}`,
    서울: s.s?.서울 || 0, 인천: s.s?.인천 || 0, 경기: s.s?.경기 || 0, 신고가: s.h || 0, 합계: s.t || 0,
  }));

  return (
    <div style={{ display: 'grid', gap: 12 }} data-daily-report="1">
      <div style={styles.card} className="ui-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <h2 style={{ ...styles.sectionTitle, margin: 0 }}>수도권 일일 신고</h2>
          <span style={{ fontSize: 11.5, color: PALETTE.textMuted }}>서울·인천·경기 아파트 매매 · 매일 아침 8시 갱신</span>
          {data.index.length > 0 && (
            <select value={r?.date || ''} onChange={(e) => setDate(e.target.value)} style={{ ...styles.select, width: 'auto', marginLeft: 'auto', fontSize: 12.5 }} data-daily-date="1">
              {data.index.map((d) => <option key={d} value={d}>{fmtDate(d)} 공개분</option>)}
            </select>
          )}
        </div>
        {data.loading ? (
          <p style={{ fontSize: 12.5, color: PALETTE.textMuted, margin: 0 }}>불러오는 중…</p>
        ) : !r ? (
          <p style={{ fontSize: 13, color: PALETTE.textMuted, margin: 0, lineHeight: 1.7 }}>
            아직 쌓인 리포트가 없어요. 매일 아침 8시에 자동으로 저장되고, 첫날은 기준만 잡아서 둘째 날부터 "그날 신고된 거래"가 나와요.
          </p>
        ) : r.total === 0 && r.baseline?.length ? (
          <p style={{ fontSize: 13, color: PALETTE.textMuted, margin: 0, lineHeight: 1.7 }}>
            {fmtDate(r.date)}은 첫 기준을 잡은 날이에요({r.baseline.length}개 지역). 다음 날부터 새로 신고된 거래가 나와요.
          </p>
        ) : (
          <>
            <p data-daily-summary="1" style={{ fontSize: 13.5, lineHeight: 1.75, margin: 0 }}>
              {fmtDate(r.date)} 새로 공개된 수도권 아파트 매매 신고는 <b>{r.total.toLocaleString()}건</b>
              ({['서울', '인천', '경기'].map((s) => `${s} ${(r.bySido?.[s] || 0).toLocaleString()}`).join(' · ')})이에요.
              {' '}이 가운데 같은 단지·같은 면적의 기록된 최고가를 넘긴 <b style={{ color: PALETTE.up }}>신고가는 {r.highCount}건</b>이에요.
              {topHigh && <> 신고가는 <b>{labelFor(topHigh.code)}</b>에서 {topHigh.h}건으로 가장 많았어요.</>}
              {r.trades?.[0] && <> 가장 비싸게 신고된 거래는 <b>{labelFor(r.trades[0].c)} {r.trades[0].a}</b> 전용 {Math.round(r.trades[0].ar)}㎡ <b>{fmtWon(r.trades[0].p)}</b>이에요.</>}
            </p>
            <p style={{ fontSize: 10.5, color: PALETTE.textMuted, margin: '8px 0 0', lineHeight: 1.6 }}>
              국토부 자료에 신고일이 없어 매일 전날 저장본과 비교해 새로 나타난 거래를 셌어요.
              {r.backfill && r.backfill.total > 0 && r.backfill.done < r.backfill.total
                ? ` 신고가 비교용 최고가 기록은 지난 3년 치를 매일 조금씩 채우는 중이에요(${Math.round((r.backfill.done / r.backfill.total) * 100)}%${r.backfill.reachedYm ? `, ${r.backfill.reachedYm.slice(0, 4)}.${r.backfill.reachedYm.slice(4)}까지` : ''}). 다 채우기 전엔 신고가가 실제보다 많이 잡힐 수 있어요.`
                : r.backfill && r.backfill.total > 0 ? ' 신고가는 지난 약 3년 치 최고가와 비교했어요.' : ' 신고가는 이 기능을 시작한 뒤 쌓은 최고가 기준이라 처음 몇 주는 실제보다 많이 잡힐 수 있어요.'}
              {/* v262: 새벽 채우기 작업이 그 뒤로 더 채웠으면 지금 진행률도 */}
              {data.backfillNow && r.backfill && data.backfillNow.total > 0 && data.backfillNow.done > r.backfill.done
                && ` (지금은 ${Math.min(100, Math.round((data.backfillNow.done / data.backfillNow.total) * 100))}%까지 채웠어요. 다음 리포트부터 반영돼요.)`}
              {r.failed?.length > 0 && ` 오늘 ${r.failed.length}개 지역은 국토부 응답 오류로 빠졌어요(내일 함께 반영).`}
            </p>
          </>
        )}
        {data.error && <p style={{ fontSize: 11.5, color: '#B23A2E', margin: '8px 0 0' }}>{data.error}</p>}
      </div>

      {series.length >= 2 && (
        <div style={styles.card} className="ui-card" data-daily-trend="1">
          <h2 style={styles.sectionTitle}>📈 날짜별 신고 건수</h2>
          <p style={{ fontSize: 10.5, color: PALETTE.textMuted, margin: '-4px 0 8px' }}>막대 = 시도별 새로 공개된 매매 신고, 선 = 그날 신고가 건수(오른쪽 축). 주말·공휴일 다음 날은 적게 나와요.</p>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <ComposedChart data={series} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                <CartesianGrid stroke={PALETTE.border} vertical={false} />
                <XAxis dataKey="day" stroke={PALETTE.textMuted} fontSize={11} tickLine={false} />
                <YAxis yAxisId="n" stroke={PALETTE.textMuted} fontSize={11} tickLine={false} width={40} />
                <YAxis yAxisId="h" orientation="right" stroke={PALETTE.up} fontSize={11} tickLine={false} width={30} allowDecimals={false} />
                <Tooltip contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                  formatter={(v, n) => [`${Number(v).toLocaleString()}건`, n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="n" dataKey="서울" stackId="a" fill="#1D4ED8" />
                <Bar yAxisId="n" dataKey="경기" stackId="a" fill="#60A5FA" />
                <Bar yAxisId="n" dataKey="인천" stackId="a" fill="#93C5FD" radius={[3, 3, 0, 0]} />
                <Line yAxisId="h" type="monotone" dataKey="신고가" stroke={PALETTE.up} strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {r && r.total > 0 && (
        <>
          <div style={styles.card} className="ui-card">
            <h2 style={styles.sectionTitle}>🔺 신고가 {r.highCount}건</h2>
            {r.highs.length === 0 ? <p style={{ fontSize: 12.5, color: PALETTE.textMuted, margin: 0 }}>이날 신고가는 없어요.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }} data-daily-table="highs">
                  <thead><tr>{['단지', '전용·층', '거래가'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                  <tbody>{r.highs.slice(0, highLimit).map((t, i) => <Row key={i} t={t} high onOpen={open(t)} styles={styles} />)}</tbody>
                </table>
                {r.highs.length > highLimit && (
                  <button type="button" onClick={() => setHighLimit((n) => n + 20)} style={{ ...pill(false), width: '100%', marginTop: 8, borderRadius: 10, padding: '9px 0' }}>
                    더 보기 ({r.highs.length - highLimit}건 남음)
                  </button>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
            <div style={styles.card} className="ui-card">
              <h2 style={styles.sectionTitle}>💰 가격순 신고 거래</h2>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }} data-daily-table="tops">
                  <thead><tr>{['', '단지', '전용·층', '거래가'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                  <tbody>{tops.map((t, i) => <Row key={i} rank={i + 1} t={t} high={isHigh(t)} onOpen={open(t)} styles={styles} />)}</tbody>
                </table>
              </div>
            </div>
            <div style={styles.card} className="ui-card">
              <h2 style={styles.sectionTitle}>📍 지역별 신고 건수</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }} data-daily-table="regions">
                <thead><tr>{['지역', '신고', '신고가'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {(r.byRegion || []).slice(0, 25).map((g) => (
                    <tr key={g.code}>
                      <td style={{ ...styles.td, fontWeight: 700 }}>{labelFor(g.code)}</td>
                      <td style={styles.td}>{g.n}건</td>
                      <td style={{ ...styles.td, color: g.h ? PALETTE.up : PALETTE.textMuted }}>{g.h}건</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

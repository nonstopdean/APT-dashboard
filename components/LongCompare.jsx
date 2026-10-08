import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { PALETTE, LINE_COLORS, fmtPct } from '../lib/ui-helpers';
import {
  LONG_PERIODS, AREA_BUCKETS, ymShiftLC, buildLongSeries, summarizeLongSeries, bucketLabel,
} from '../lib/long-compare';

// 비교분석 탭의 "장기 시세 비교". 위에서 고른 비교 대상(A/B/C)을 화면 조회 기간과 상관없이
// 1~10년치 실거래로 다시 받아, 같은 평형대끼리 평균 평당가 추이를 겹쳐 본다(호갱노노·아실의 과거 시세 비교).
// 지역(구)마다 한 번만 받고, 단지는 그 안에서 걸러낸다. 지난 달 자료는 서버가 30일 저장한다(lib/molit.js).
const nowYm = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const isSidoAggregate = (code) => /000$/.test(String(code || ''));

export default function LongCompare({ items, isRent }) {
  const [periodKey, setPeriodKey] = useState('3y');
  const [areaKey, setAreaKey] = useState('mid');
  const [rowsByCode, setRowsByCode] = useState({}); // `${endpoint}|${code}|${months}` -> rows
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const period = LONG_PERIODS.find((p) => p.key === periodKey) || LONG_PERIODS[1];
  const endYm = nowYm();
  const startYm = ymShiftLC(endYm, -(period.months - 1));
  const unit = period.months >= 60 ? 'quarter' : 'month';
  const endpoint = isRent ? '/api/rents' : '/api/trades';
  const valueOf = (r) => (isRent ? (r.isJeonse ? r.depositPerPyeong : null) : r.pricePerPyeong);

  const active = (items || []).filter((it) => it && it.label);
  const codeOf = (it) => (it.kind === 'region' ? it.code : it.regionCode);
  const codes = [...new Set(active.map(codeOf).filter((c) => c && !isSidoAggregate(c)))];
  const cacheKey = (code) => `${endpoint}|${code}|${period.months}`;
  const codesKey = codes.join(',');

  useEffect(() => {
    const missing = codes.filter((c) => !rowsByCode[cacheKey(c)]);
    if (!missing.length) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all(missing.map((code) => fetch(`${endpoint}?codes=${code}&start=${startYm}&end=${endYm}`)
      .then((res) => res.json())
      .then((json) => {
        const rows = [];
        (json?.months || []).forEach((ym) => {
          (json?.data?.[`${code}_${ym}`] || []).forEach((r) => rows.push(r));
        });
        return [code, rows, json?.error ? '일부 기간을 불러오지 못했어요' : ''];
      })
      .catch(() => [code, null, '불러오지 못했어요'])))
      .then((results) => {
        if (cancelled) return;
        setRowsByCode((prev) => {
          const next = { ...prev };
          results.forEach(([code, rows]) => { if (rows) next[cacheKey(code)] = rows; });
          return next;
        });
        const msg = results.map((r) => r[2]).find(Boolean);
        if (msg) setError(msg);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codesKey, endpoint, period.months]);

  const seriesList = useMemo(() => active.map((it) => {
    const code = codeOf(it);
    if (isSidoAggregate(code)) return { label: it.label, unsupported: true, series: [], sum: summarizeLongSeries([]) };
    const all = rowsByCode[cacheKey(code)] || [];
    const rows = it.kind === 'region' ? all : all.filter((r) => r.apt === it.apt && r.dong === it.dong);
    const series = buildLongSeries(rows, { startYm, endYm, unit, areaKey, valueOf, minN: it.kind === 'region' ? 10 : 1 });
    return { label: it.label, series, sum: summarizeLongSeries(series) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [items, rowsByCode, startYm, endYm, unit, areaKey, isRent, endpoint, period.months]);

  const chartData = useMemo(() => {
    const base = seriesList.find((s) => s.series.length)?.series || [];
    return base.map((pt, i) => {
      const row = { b: bucketLabel(pt.bucket) };
      seriesList.forEach((s) => { row[s.label] = s.series[i]?.value != null ? Math.round(s.series[i].value) : null; });
      return row;
    });
  }, [seriesList]);

  if (!active.length) return null;

  const chip = (on) => ({
    border: `1px solid ${on ? PALETTE.accent : PALETTE.border}`, background: on ? PALETTE.accent : PALETTE.panel,
    color: on ? '#fff' : PALETTE.textPrimary, borderRadius: 999, padding: '5px 11px', fontSize: 12, cursor: 'pointer',
  });
  const fmtEok = (v) => (v == null ? '-' : `${(v / 10000).toFixed(2)}억`);

  return (
    <div style={{ marginBottom: 22 }}>
      <h3 style={{ fontSize: 14, fontWeight: 800, margin: '0 0 4px', color: PALETTE.textPrimary }}>장기 시세 비교</h3>
      <p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: '0 0 10px' }}>
        같은 평형대끼리 {isRent ? '전세 평당 보증금' : '평당 매매가'} 평균을 비교해요. 처음 불러올 때는 기간이 길수록 10~20초 걸릴 수 있어요.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        {LONG_PERIODS.map((p) => <button key={p.key} style={chip(p.key === periodKey)} onClick={() => setPeriodKey(p.key)}>{p.label}</button>)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {AREA_BUCKETS.map((a) => <button key={a.key} style={chip(a.key === areaKey)} onClick={() => setAreaKey(a.key)}>{a.label}</button>)}
      </div>
      {loading && <div style={{ fontSize: 12, color: PALETTE.textMuted, marginBottom: 8 }}>{period.label}치 실거래를 불러오는 중...</div>}
      {error && <div style={{ fontSize: 12, color: '#B23A2E', marginBottom: 8 }}>{error}</div>}
      <div style={{ width: '100%', height: 300, marginBottom: 12 }}>
        <ResponsiveContainer>
          <LineChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={PALETTE.border} vertical={false} />
            <XAxis dataKey="b" stroke={PALETTE.textMuted} fontSize={11} tickLine={false} minTickGap={16} />
            <YAxis stroke={PALETTE.textMuted} fontSize={11} tickLine={false} width={52} tickFormatter={(v) => `${(v / 10000).toFixed(1)}억`} />
            <Tooltip
              contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
              formatter={(v) => [v == null ? '-' : `평당 ${fmtEok(v)}`]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {seriesList.map((s, i) => (
              <Line key={s.label} type="monotone" dataKey={s.label} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={{ r: 1.5 }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: PALETTE.textMuted, textAlign: 'left' }}>
              <th style={{ padding: '6px 4px' }}>대상</th>
              <th style={{ padding: '6px 4px' }}>최근 평당가</th>
              <th style={{ padding: '6px 4px' }}>{period.label} 등락률</th>
              <th style={{ padding: '6px 4px' }}>최고 평당가(시점)</th>
              <th style={{ padding: '6px 4px' }}>거래</th>
            </tr>
          </thead>
          <tbody>
            {seriesList.map((s, i) => (
              <tr key={s.label} style={{ borderTop: `1px solid ${PALETTE.border}` }}>
                <td style={{ padding: '6px 4px', color: LINE_COLORS[i % LINE_COLORS.length], fontWeight: 700 }}>{s.label}</td>
                {s.unsupported ? (
                  <td colSpan={4} style={{ padding: '6px 4px', color: PALETTE.textMuted }}>시·도 전체는 장기 비교에서 빠져요(호출이 너무 많아요). 구·시를 골라주세요.</td>
                ) : (
                  <>
                    <td style={{ padding: '6px 4px' }}>{fmtEok(s.sum.latest)}{s.sum.latestBucket ? ` (${bucketLabel(s.sum.latestBucket)})` : ''}</td>
                    <td style={{ padding: '6px 4px', color: s.sum.changePct > 0 ? PALETTE.up : s.sum.changePct < 0 ? PALETTE.down : PALETTE.textPrimary }}>
                      {s.sum.changePct != null ? fmtPct(s.sum.changePct) : '-'}
                      {s.sum.firstBucket && s.series[0] && s.sum.firstBucket !== s.series[0].bucket && (
                        <span style={{ color: PALETTE.textMuted, fontSize: 10.5 }}> ({bucketLabel(s.sum.firstBucket)}부터)</span>
                      )}
                    </td>
                    <td style={{ padding: '6px 4px' }}>{s.sum.peak ? `${fmtEok(s.sum.peak.value)} (${bucketLabel(s.sum.peak.bucket)})` : '-'}</td>
                    <td style={{ padding: '6px 4px' }}>{s.sum.count ? `${s.sum.count.toLocaleString()}건` : (loading ? '…' : '이 평형 거래 없음')}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

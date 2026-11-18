'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { PALETTE, fmtArea } from '../lib/ui-helpers';
import {
  dealTs, floorOf, priceOfDeal, rowsOfMode, pyeongOptions, topPyeong, aptDongOptions, floorOptions,
  inPyeong, inUnit, monthlyAverage, complexRowsFromApi, fmtEok, dealPriceText, ymRange,
} from '../lib/complex-trades';
import { supplyPyeong } from '../lib/pyeong';

// v241: 지도 탭 단지 상세의 실거래가 — 아실처럼 매매/전월세 · 평형 · 동 · 층을 고르면
// 그래프(거래 하나하나 점 + 월 평균 선)와 아래 실거래 내역(5개씩 더 보기)이 같이 바뀐다.
// 지도에서 보고 있는 거래 유형(매매 또는 전월세)은 page.jsx가 이미 받은 aptHistory를 쓰고,
// 다른 유형은 그 탭을 누를 때 여기서 받는다(최근 3년, 버튼으로 최대 20년).
const FIRST = 5;
const MORE = 10;

const chipStyle = (on) => ({
  border: `1px solid ${on ? PALETTE.accent : PALETTE.border}`,
  background: on ? 'rgba(239,68,68,0.10)' : '#fff',
  color: on ? PALETTE.up : PALETTE.textSecondary,
  fontWeight: on ? 700 : 500,
  borderRadius: 8, padding: '4px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap',
});
const selectStyle = {
  flex: 1, minWidth: 0, padding: '6px 8px', borderRadius: 8, border: `1px solid ${PALETTE.border}`,
  fontSize: 12, background: '#fff', color: PALETTE.textPrimary,
};
const ymd = (t) => `${t.year}.${String(t.month).padStart(2, '0')}.${String(t.day).padStart(2, '0')}`;
const fmtTick = (ts) => {
  const d = new Date(ts);
  return `${String(d.getUTCFullYear()).slice(2)}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const noDot = () => <g />;

function TipBox({ active, payload }) {
  const p = active && payload && payload[0] && payload[0].payload;
  if (!p || !p.tip) return null;
  return (
    <div style={{ background: '#fff', border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: '6px 9px', fontSize: 11.5, boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
      <b>{p.price}</b>
      <div style={{ color: PALETTE.textMuted, marginTop: 2 }}>{p.tip}</div>
    </div>
  );
}

export default function ComplexTradePanel({
  selectedApt, aptHistory, aptHistoryLoading, aptHistoryFullRange, loadFullAptHistory,
  isRent, tradeEndpoint, rentEndpoint,
}) {
  const currentType = isRent ? 'rent' : 'trade';
  const aptKey = `${selectedApt.regionCode}|${selectedApt.dong}|${selectedApt.apt}`;
  const [deal, setDeal] = useState(currentType);
  const [rentKind, setRentKind] = useState('jeonse');
  const [pyeongSel, setPyeongSel] = useState(null); // null = 거래 가장 많은 평형
  const [aptDongSel, setAptDongSel] = useState('all');
  const [floorSel, setFloorSel] = useState('all');
  const [limit, setLimit] = useState(FIRST);
  const [other, setOther] = useState({ key: '', rows: [], loading: false, full: false, error: false });

  // 단지가 바뀌면 처음 상태로
  useEffect(() => {
    setDeal(currentType); setRentKind('jeonse'); setPyeongSel(null); setAptDongSel('all'); setFloorSel('all'); setLimit(FIRST);
    setOther({ key: '', rows: [], loading: false, full: false, error: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aptKey]);

  const fetchOther = (monthsBack) => {
    const ep = deal === 'rent' ? rentEndpoint : tradeEndpoint;
    if (!ep) return;
    const { start, end } = ymRange(monthsBack);
    // 받는 사이 단지·탭이 바뀌면 결과를 버린다(key가 다르면 그대로 둔다)
    const k = `${aptKey}|${deal}`;
    const { regionCode, apt, dong } = selectedApt;
    setOther((o) => ({ ...(o.key === k ? o : { rows: [], full: false }), key: k, loading: true, error: false }));
    fetch(`${ep}?codes=${regionCode}&start=${start}&end=${end}`)
      .then((r) => r.json())
      .then((json) => {
        const got = complexRowsFromApi(json, regionCode, apt, dong);
        setOther((o) => (o.key === k ? { key: k, rows: got, loading: false, full: monthsBack > 36, error: false } : o));
      })
      .catch(() => setOther((o) => (o.key === k ? { ...o, loading: false, error: true } : o)));
  };

  // 지도에서 보고 있지 않은 유형 탭을 누르면 그때 받는다(최근 3년)
  const otherKey = `${aptKey}|${deal}`;
  useEffect(() => {
    if (deal === currentType || other.key === otherKey) return;
    fetchOther(35);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal, currentType, otherKey]);

  const isOwn = deal === currentType;
  const rows = isOwn ? aptHistory : (other.key === otherKey ? other.rows : []);
  const loading = isOwn ? aptHistoryLoading : other.loading || other.key !== otherKey;
  const fullRange = isOwn ? aptHistoryFullRange : other.full;
  const mode = deal === 'trade' ? 'trade' : rentKind;

  const v = useMemo(() => {
    const modeRows = rowsOfMode(rows, mode).filter((t) => priceOfDeal(t, mode) != null);
    const opts = pyeongOptions(modeRows);
    const pyeong = pyeongSel === 'all' || opts.some((o) => o.value === pyeongSel) ? pyeongSel : topPyeong(opts);
    const pRows = modeRows.filter((t) => inPyeong(t, pyeong));
    const dongOpts = aptDongOptions(pRows);
    const aptDong = dongOpts.includes(aptDongSel) ? aptDongSel : 'all';
    const floorOpts = floorOptions(pRows.filter((t) => inUnit(t, aptDong, 'all')));
    const floor = floorOpts.map(String).includes(String(floorSel)) ? String(floorSel) : 'all';
    const unitRows = pRows.filter((t) => inUnit(t, aptDong, floor));
    const unitOn = aptDong !== 'all' || floor !== 'all';
    const point = (t) => ({
      t: dealTs(t), v: priceOfDeal(t, mode), price: dealPriceText(t, deal),
      tip: `${ymd(t)} · ${t.aptDong ? `${t.aptDong}동 ` : ''}${floorOf(t) != null ? `${floorOf(t)}층` : ''} · ${fmtArea(t.area)}`,
    });
    const unitSet = new Set(unitRows);
    return {
      opts, pyeong, pRows, dongOpts, aptDong, floorOpts, floor, unitRows, unitOn,
      base: pRows.filter((t) => !unitOn || !unitSet.has(t)).map(point),
      hi: unitOn ? unitRows.map(point) : [],
      avg: monthlyAverage(pRows, mode),
      max: unitRows.reduce((m, t) => (m == null || priceOfDeal(t, mode) > priceOfDeal(m, mode) ? t : m), null),
    };
  }, [rows, mode, deal, pyeongSel, aptDongSel, floorSel]);

  const switchDeal = (d) => { if (d === deal) return; setDeal(d); setPyeongSel(null); setAptDongSel('all'); setFloorSel('all'); setLimit(FIRST); };
  const resetUnit = () => { setAptDongSel('all'); setFloorSel('all'); setLimit(FIRST); };
  const loadOlder = () => (isOwn ? loadFullAptHistory() : fetchOther(239));
  const latest = v.unitRows[0];
  const valueName = mode === 'trade' ? '매매가' : mode === 'jeonse' ? '전세 보증금' : '월세';

  return (
    <div data-trade-panel="1">
      {/* 매매 / 전월세 */}
      <div style={{ display: 'flex', background: PALETTE.panelAlt, borderRadius: 10, padding: 3, marginBottom: 10 }}>
        {[['trade', '매매'], ...(rentEndpoint ? [['rent', '전월세']] : [])].map(([k, l]) => (
          <button
            key={k} type="button" data-trade-deal={k} onClick={() => switchDeal(k)}
            style={{
              flex: 1, border: 'none', borderRadius: 8, padding: '7px 0', fontSize: 12.5, cursor: 'pointer',
              background: deal === k ? '#fff' : 'transparent', color: deal === k ? PALETTE.textPrimary : PALETTE.textSecondary,
              fontWeight: deal === k ? 800 : 500, boxShadow: deal === k ? '0 1px 4px rgba(0,0,0,0.10)' : 'none',
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {deal === 'rent' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {[['jeonse', '전세'], ['wolse', '월세']].map(([k, l]) => (
            <button key={k} type="button" data-rent-kind={k} onClick={() => { setRentKind(k); setLimit(FIRST); }} style={chipStyle(rentKind === k)}>{l}</button>
          ))}
        </div>
      )}

      {/* 평형 */}
      {v.opts.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
          {v.opts.length > 1 && (
            <button type="button" data-pyeong="all" onClick={() => { setPyeongSel('all'); resetUnit(); }} style={chipStyle(v.pyeong === 'all')}>전체</button>
          )}
          {v.opts.map((o) => (
            <button
              key={o.value} type="button" data-pyeong={o.value} title={`전용 ${o.sqm}㎡ · ${o.count}건`}
              onClick={() => { setPyeongSel(o.value); resetUnit(); }} style={chipStyle(v.pyeong === o.value)}
            >
              {o.label}<span style={{ fontSize: 10, opacity: 0.7 }}> {o.sqm}㎡</span>
            </button>
          ))}
        </div>
      )}

      {/* 동 · 층 */}
      {v.pRows.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          {v.dongOpts.length > 0 && (
            <select data-unit-dong="1" value={v.aptDong} onChange={(e) => { setAptDongSel(e.target.value); setFloorSel('all'); setLimit(FIRST); }} style={selectStyle}>
              <option value="all">전체 동</option>
              {v.dongOpts.map((d) => <option key={d} value={d}>{d}동</option>)}
            </select>
          )}
          <select data-unit-floor="1" value={v.floor} onChange={(e) => { setFloorSel(e.target.value); setLimit(FIRST); }} style={selectStyle}>
            <option value="all">전체 층</option>
            {v.floorOpts.map((f) => <option key={f} value={String(f)}>{f}층</option>)}
          </select>
          {v.unitOn && <button type="button" onClick={resetUnit} style={{ ...chipStyle(false), padding: '4px 8px' }}>↺</button>}
        </div>
      )}
      {v.pRows.length > 0 && (
        <div style={{ fontSize: 10, color: PALETTE.textMuted, marginBottom: 8 }}>
          {v.dongOpts.length > 0 ? '호수는 국토부가 공개하지 않아 동·층까지 골라 볼 수 있어요.' : `${deal === 'rent' ? '전월세 자료에는 동 정보가 없어' : '이 단지 거래에는 동 정보가 없어'} 층만 고를 수 있어요.`}
        </div>
      )}

      {/* 요약 한 줄 */}
      {latest && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 11.5, flexWrap: 'wrap' }}>
          <span>최근 <b style={{ fontSize: 13 }}>{dealPriceText(latest, deal)}</b> <span style={{ color: PALETTE.textMuted }}>{ymd(latest)}</span></span>
          {v.max && v.unitRows.length > 1 && (
            <span>최고 <b style={{ color: PALETTE.up }}>{dealPriceText(v.max, deal)}</b> <span style={{ color: PALETTE.textMuted }}>{ymd(v.max)}</span></span>
          )}
        </div>
      )}

      {/* 그래프 */}
      {loading && !rows.length ? (
        <p style={{ fontSize: 12, color: PALETTE.textMuted, padding: '24px 0', textAlign: 'center' }}>실거래가를 불러오는 중이에요…</p>
      ) : !isOwn && other.error ? (
        <p style={{ fontSize: 12, color: '#B23A2E', padding: '16px 0', textAlign: 'center' }}>실거래가를 불러오지 못했어요. 탭을 다시 눌러 주세요.</p>
      ) : v.pRows.length === 0 ? (
        <p style={{ fontSize: 12, color: PALETTE.textMuted, padding: '20px 0', textAlign: 'center' }}>
          {fullRange ? '' : '최근 3년 동안 '}이 조건의 {deal === 'trade' ? '매매' : rentKind === 'jeonse' ? '전세' : '월세'} 거래가 없어요.
        </p>
      ) : (
        <div data-trade-chart="1" style={{ width: '100%', height: 200 }}>
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={PALETTE.border} vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} stroke={PALETTE.textMuted} fontSize={10} tickLine={false} tickCount={5} />
              <YAxis dataKey="v" type="number" domain={['auto', 'auto']} tickFormatter={(x) => fmtEok(x)} stroke={PALETTE.textMuted} fontSize={10} tickLine={false} width={44} />
              <Tooltip content={<TipBox />} cursor={{ strokeDasharray: '3 3' }} />
              <Scatter data={v.avg} line={{ stroke: PALETTE.textSecondary, strokeWidth: 1.5 }} shape={noDot} isAnimationActive={false} legendType="none" />
              <Scatter
                data={v.base} isAnimationActive={false}
                shape={(p) => <circle cx={p.cx} cy={p.cy} r={3} fill={v.unitOn ? PALETTE.borderStrong : PALETTE.accent} fillOpacity={v.unitOn ? 0.6 : 0.55} />}
              />
              {v.unitOn && (
                <Scatter data={v.hi} isAnimationActive={false} shape={(p) => <circle cx={p.cx} cy={p.cy} r={4.5} fill={PALETTE.accent} stroke="#fff" strokeWidth={1} />} />
              )}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
      {v.pRows.length > 0 && (
        <div style={{ fontSize: 10, color: PALETTE.textMuted, margin: '2px 0 4px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span>● 거래 하나하나{v.unitOn ? '(빨강 = 고른 동·층)' : ''}</span>
          <span>— 월 평균 {valueName}</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 10, color: PALETTE.textMuted, marginBottom: 14 }}>
        <span>{fullRange ? '최대 20년' : '최근 3년'} · 국토교통부 실거래가</span>
        {!fullRange && (
          <button type="button" onClick={loadOlder} disabled={loading} style={{ border: `1px solid ${PALETTE.border}`, borderRadius: 6, padding: '2px 8px', fontSize: 10, background: 'transparent', color: PALETTE.accent, cursor: 'pointer' }}>
            {loading ? '불러오는 중…' : '더 오래된 기록(최대 20년)'}
          </button>
        )}
      </div>

      {/* 실거래 내역 */}
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>
        실거래 내역 <span style={{ fontSize: 11, fontWeight: 500, color: PALETTE.textMuted }}>{v.unitRows.length.toLocaleString()}건</span>
      </div>
      <div data-trade-list="1">
        {v.unitRows.slice(0, limit).map((t, i) => (
          <div key={i} data-trade-row="1" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 2px', borderBottom: `1px solid ${PALETTE.border}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{ymd(t)}</div>
              <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>
                {supplyPyeong(t.area)}평({Math.round(t.area)}㎡) · {t.aptDong ? `${t.aptDong}동 ` : ''}{floorOf(t) != null ? `${floorOf(t)}층` : ''}
              </div>
            </div>
            <b style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{dealPriceText(t, deal)}</b>
          </div>
        ))}
        {!loading && v.unitRows.length === 0 && v.pRows.length > 0 && (
          <div style={{ fontSize: 11.5, color: PALETTE.textMuted, padding: '8px 2px' }}>고른 동·층의 거래가 없어요.</div>
        )}
      </div>
      {v.unitRows.length > limit && (
        <button
          type="button" data-trade-more="1" onClick={() => setLimit((n) => n + MORE)}
          style={{ marginTop: 8, width: '100%', border: `1px solid ${PALETTE.border}`, background: '#fff', borderRadius: 8, padding: '8px 0', fontSize: 12, fontWeight: 700, color: PALETTE.textSecondary, cursor: 'pointer' }}
        >
          더 보기 (남은 {(v.unitRows.length - limit).toLocaleString()}건)
        </button>
      )}
    </div>
  );
}

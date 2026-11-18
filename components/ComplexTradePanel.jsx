'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { BLUE, fmtArea } from '../lib/ui-helpers';
import {
  dealTs, floorOf, priceOfDeal, rowsOfMode, pyeongOptions, topPyeong, aptDongOptions, floorOptions,
  inPyeong, inUnit, monthlyAverage, complexRowsFromApi, fmtEok, dealPriceText, ymRange, monthTicks,
} from '../lib/complex-trades';
import { supplyPyeong } from '../lib/pyeong';

// v241: 지도 탭 단지 상세의 실거래가 — 아실처럼 매매/전월세 · 평형 · 동 · 층을 고르면
// 그래프(거래 하나하나 점 + 월 평균 선)와 아래 실거래 내역(5개씩 더 보기)이 같이 바뀐다.
// 지도에서 보고 있는 거래 유형(매매 또는 전월세)은 page.jsx가 이미 받은 aptHistory를 쓰고,
// 다른 유형은 그 탭을 누를 때 여기서 받는다(최근 3년, 버튼으로 최대 20년).
// v242: 푸른 톤으로 다시 꾸밈(BLUE 토큰, lib/ui-helpers.js).
const FIRST = 5;
const MORE = 10;

const pill = (on) => ({
  flexShrink: 0, border: 'none', borderRadius: 999, padding: '6px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
  background: on ? BLUE.primary : BLUE.softer, color: on ? '#fff' : BLUE.sub, fontWeight: on ? 700 : 600,
  boxShadow: on ? '0 2px 8px rgba(37,99,235,0.28)' : `inset 0 0 0 1px ${BLUE.line}`,
});
const ARROW = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%2355657F' stroke-width='1.5'/%3E%3C/svg%3E\")";
const selectStyle = (on) => ({
  flex: 1, minWidth: 0, appearance: 'none', WebkitAppearance: 'none', padding: '9px 28px 9px 12px', borderRadius: 10,
  border: `1px solid ${on ? BLUE.primary : BLUE.line}`, background: `${on ? BLUE.soft : '#fff'} ${ARROW} no-repeat right 11px center`,
  fontSize: 12.5, fontWeight: 600, color: on ? BLUE.dark : BLUE.ink, cursor: 'pointer',
});
const tag = { display: 'inline-block', background: BLUE.tag, color: BLUE.sub, borderRadius: 6, padding: '1px 6px', fontSize: 10.5, fontWeight: 600, marginRight: 4 };
const label = { fontSize: 10.5, color: BLUE.muted, fontWeight: 600, letterSpacing: '0.02em' };
const ymd = (t) => `${t.year}.${String(t.month).padStart(2, '0')}.${String(t.day).padStart(2, '0')}`;
const fmtTick = (ts) => {
  const d = new Date(ts);
  return `${String(d.getUTCFullYear()).slice(2)}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const noDot = () => <g />;
const unitText = (t) => `${t.aptDong ? `${t.aptDong}동 ` : ''}${floorOf(t) != null ? `${floorOf(t)}층` : ''}`.trim();

function TipBox({ active, payload }) {
  const p = active && payload && payload[0] && payload[0].payload;
  if (!p || !p.tip) return null;
  return (
    <div style={{ background: BLUE.ink, color: '#fff', borderRadius: 10, padding: '7px 10px', fontSize: 11.5, boxShadow: '0 6px 18px rgba(15,27,51,0.25)' }}>
      <b style={{ fontSize: 13 }}>{p.price}</b>
      <div style={{ opacity: 0.75, marginTop: 2 }}>{p.tip}</div>
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
      tip: `${ymd(t)} · ${unitText(t)} · ${fmtArea(t.area)}`,
    });
    const unitSet = new Set(unitRows);
    const tss = pRows.map(dealTs);
    const minTs = tss.length ? Math.min(...tss) : null;
    const maxTs = tss.length ? Math.max(...tss) : null;
    return {
      minTs, maxTs, ticks: monthTicks(minTs, maxTs, 5),
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
  const kindName = deal === 'trade' ? '매매' : rentKind === 'jeonse' ? '전세' : '월세';
  const pyeongLabel = v.pyeong === 'all' ? '전체 평형' : `${v.pyeong}평`;
  const waiting = loading && !rows.length;

  return (
    <div data-trade-panel="1" style={{ color: BLUE.ink }}>
      {/* 매매 / 전월세 — 파란 세그먼트 */}
      <div style={{ display: 'flex', background: BLUE.soft, borderRadius: 12, padding: 4, marginBottom: 10 }}>
        {[['trade', '매매'], ...(rentEndpoint ? [['rent', '전월세']] : [])].map(([k, l]) => (
          <button
            key={k} type="button" data-trade-deal={k} onClick={() => switchDeal(k)}
            style={{
              flex: 1, border: 'none', borderRadius: 9, padding: '8px 0', fontSize: 13, cursor: 'pointer', transition: 'all .15s',
              background: deal === k ? BLUE.primary : 'transparent', color: deal === k ? '#fff' : BLUE.sub,
              fontWeight: deal === k ? 800 : 600, boxShadow: deal === k ? '0 3px 10px rgba(37,99,235,0.30)' : 'none',
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {deal === 'rent' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {[['jeonse', '전세'], ['wolse', '월세']].map(([k, l]) => (
            <button key={k} type="button" data-rent-kind={k} onClick={() => { setRentKind(k); setLimit(FIRST); }} style={pill(rentKind === k)}>{l}</button>
          ))}
        </div>
      )}

      {/* 평형 — 한 줄로 옆으로 밀어 보기 */}
      {v.opts.length > 0 && (
        <div className="trade-pyeong-row" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 8, scrollbarWidth: 'none' }}>
          {v.opts.length > 1 && (
            <button type="button" data-pyeong="all" onClick={() => { setPyeongSel('all'); resetUnit(); }} style={pill(v.pyeong === 'all')}>전체</button>
          )}
          {v.opts.map((o) => (
            <button
              key={o.value} type="button" data-pyeong={o.value} title={`전용 ${o.sqm}㎡ · ${o.count}건`}
              onClick={() => { setPyeongSel(o.value); resetUnit(); }} style={pill(v.pyeong === o.value)}
            >
              {o.label}<span style={{ fontSize: 10.5, opacity: 0.75, fontWeight: 500 }}> {o.sqm}㎡</span>
            </button>
          ))}
        </div>
      )}

      {/* 동 · 층 */}
      {v.pRows.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {v.dongOpts.length > 0 && (
            <select data-unit-dong="1" value={v.aptDong} onChange={(e) => { setAptDongSel(e.target.value); setFloorSel('all'); setLimit(FIRST); }} style={selectStyle(v.aptDong !== 'all')}>
              <option value="all">전체 동</option>
              {v.dongOpts.map((d) => <option key={d} value={d}>{d}동</option>)}
            </select>
          )}
          <select data-unit-floor="1" value={v.floor} onChange={(e) => { setFloorSel(e.target.value); setLimit(FIRST); }} style={selectStyle(v.floor !== 'all')}>
            <option value="all">전체 층</option>
            {v.floorOpts.map((f) => <option key={f} value={String(f)}>{f}층</option>)}
          </select>
          {v.unitOn && (
            <button type="button" onClick={resetUnit} title="동·층 선택 지우기" style={{ flexShrink: 0, border: 'none', background: BLUE.soft, color: BLUE.dark, borderRadius: 10, width: 36, height: 36, fontSize: 15, cursor: 'pointer' }}>↺</button>
          )}
        </div>
      )}
      {v.pRows.length > 0 && (
        <div style={{ fontSize: 10.5, color: BLUE.muted, margin: '6px 2px 12px' }}>
          ⓘ {v.dongOpts.length > 0 ? '호수는 국토부가 공개하지 않아 동·층까지 골라 볼 수 있어요.' : `${deal === 'rent' ? '전월세 자료에는 동 정보가 없어' : '이 단지 거래에는 동 정보가 없어'} 층만 고를 수 있어요.`}
        </div>
      )}

      {/* 그래프 카드 */}
      <div style={{ border: `1px solid ${BLUE.line}`, borderRadius: 14, padding: '12px 12px 8px', background: '#fff', boxShadow: '0 2px 10px rgba(30,58,138,0.05)' }}>
        {latest && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, marginBottom: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={label}>최근 {kindName} · {pyeongLabel}{v.unitOn ? ` · ${[v.aptDong !== 'all' ? `${v.aptDong}동` : '', v.floor !== 'all' ? `${v.floor}층` : ''].filter(Boolean).join(' ')}` : ''}</div>
              <div data-trade-latest="1" style={{ fontSize: 22, fontWeight: 800, color: BLUE.ink, letterSpacing: '-0.02em', lineHeight: 1.2 }}>{dealPriceText(latest, deal)}</div>
              <div style={{ fontSize: 11, color: BLUE.sub }}>{ymd(latest)} · {unitText(latest)}</div>
            </div>
            {v.max && v.unitRows.length > 1 && (
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={label}>최고가</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: BLUE.dark }}>{dealPriceText(v.max, deal)}</div>
                <div style={{ fontSize: 10.5, color: BLUE.muted }}>{ymd(v.max)}</div>
              </div>
            )}
          </div>
        )}
        {waiting ? (
          <p style={{ fontSize: 12, color: BLUE.muted, padding: '36px 0', textAlign: 'center', margin: 0 }}>실거래가를 불러오는 중이에요…</p>
        ) : !isOwn && other.error ? (
          <p style={{ fontSize: 12, color: '#B23A2E', padding: '24px 0', textAlign: 'center', margin: 0 }}>실거래가를 불러오지 못했어요. 탭을 다시 눌러 주세요.</p>
        ) : v.pRows.length === 0 ? (
          <p style={{ fontSize: 12, color: BLUE.muted, padding: '28px 0', textAlign: 'center', margin: 0 }}>
            {fullRange ? '' : '최근 3년 동안 '}이 조건의 {kindName} 거래가 없어요.
          </p>
        ) : (
          <div data-trade-chart="1" style={{ width: '100%', height: 190 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 6, right: 6, left: -6, bottom: 0 }}>
                <CartesianGrid stroke={BLUE.line} strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={[v.minTs, v.maxTs]} ticks={v.ticks} tickFormatter={fmtTick} stroke={BLUE.muted} fontSize={10} tickLine={false} axisLine={false} />
                <YAxis dataKey="v" type="number" domain={['auto', 'auto']} tickFormatter={(x) => fmtEok(x)} stroke={BLUE.muted} fontSize={10} tickLine={false} axisLine={false} width={44} />
                <Tooltip content={<TipBox />} cursor={{ stroke: BLUE.line, strokeDasharray: '3 3' }} />
                <Scatter
                  data={v.base} isAnimationActive={false}
                  shape={(p) => <circle cx={p.cx} cy={p.cy} r={3.2} fill={v.unitOn ? '#CBD5E1' : BLUE.dot} fillOpacity={v.unitOn ? 0.7 : 0.55} />}
                />
                <Scatter data={v.avg} line={{ stroke: BLUE.deep, strokeWidth: 2 }} shape={noDot} isAnimationActive={false} legendType="none" />
                {v.unitOn && (
                  <Scatter data={v.hi} isAnimationActive={false} shape={(p) => <circle cx={p.cx} cy={p.cy} r={5} fill={BLUE.primary} stroke="#fff" strokeWidth={1.5} />} />
                )}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}
        {v.pRows.length > 0 && (
          <div style={{ fontSize: 10.5, color: BLUE.sub, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', padding: '4px 2px 2px' }}>
            <span><span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 7, background: v.unitOn ? '#CBD5E1' : BLUE.dot, marginRight: 4 }} />거래</span>
            {v.unitOn && <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 8, background: BLUE.primary, marginRight: 4 }} />고른 동·층</span>}
            <span><span style={{ display: 'inline-block', width: 12, height: 2, background: BLUE.deep, marginRight: 4, verticalAlign: 'middle' }} />월 평균 {valueName}</span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 10.5, color: BLUE.muted, margin: '6px 2px 16px' }}>
        <span>{fullRange ? '최대 20년' : '최근 3년'} · 국토교통부 실거래가</span>
        {!fullRange && (
          <button type="button" onClick={loadOlder} disabled={loading} style={{ border: 'none', background: 'transparent', padding: 0, fontSize: 11, fontWeight: 700, color: BLUE.primary, cursor: 'pointer' }}>
            {loading ? '불러오는 중…' : '더 오래된 기록 보기 ›'}
          </button>
        )}
      </div>

      {/* 실거래 내역 (불러오는 중엔 "0건"이 보이지 않게 숨긴다) */}
      {!waiting && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 800 }}>실거래 내역</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: BLUE.primary }}>{v.unitRows.length.toLocaleString()}건</span>
          </div>
          <div data-trade-list="1" style={{ border: `1px solid ${BLUE.line}`, borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
            {v.unitRows.slice(0, limit).map((t, i) => (
              <div key={i} data-trade-row="1" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: i ? `1px solid ${BLUE.tag}` : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: BLUE.ink }}>{ymd(t)}</div>
                  <div style={{ marginTop: 3 }}>
                    <span style={tag}>{supplyPyeong(t.area)}평 · {Math.round(t.area)}㎡</span>
                    {unitText(t) && <span style={tag}>{unitText(t)}</span>}
                  </div>
                </div>
                <b style={{ fontSize: 14.5, whiteSpace: 'nowrap', color: BLUE.ink, letterSpacing: '-0.01em' }}>{dealPriceText(t, deal)}</b>
              </div>
            ))}
            {!loading && v.unitRows.length === 0 && (
              <div style={{ fontSize: 12, color: BLUE.muted, padding: '14px 12px' }}>{v.pRows.length ? '고른 동·층의 거래가 없어요.' : '표시할 거래가 없어요.'}</div>
            )}
          </div>
          {v.unitRows.length > limit && (
            <button
              type="button" data-trade-more="1" onClick={() => setLimit((n) => n + MORE)}
              style={{ marginTop: 8, width: '100%', border: 'none', background: BLUE.soft, borderRadius: 12, padding: '10px 0', fontSize: 12.5, fontWeight: 700, color: BLUE.dark, cursor: 'pointer' }}
            >
              더 보기 <span style={{ fontWeight: 500, opacity: 0.8 }}>({(v.unitRows.length - limit).toLocaleString()}건 남음)</span>
            </button>
          )}
        </>
      )}
    </div>
  );
}

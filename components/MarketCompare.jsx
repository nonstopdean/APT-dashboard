'use client';

import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  PALETTE, LINE_COLORS, fmtPct, fmtWon, fmtManwon, labelFor,
} from '../lib/ui-helpers';
import {
  regionCompareRows, searchRows, complexLabels, complexCompareStats,
  COMPARE_SORTS, COMPARE_SIZES, categoryRows, categoryGroups, compareUnitOf,
} from '../lib/market-compare';
import { supplyPyeong } from '../lib/pyeong';
import LongCompare from './LongCompare';

// v280: 단지 비교 "카테고리로 고르기" — 지역 → 동 → 평형대 → 기준을 눌러 목록에서 담는다(이름을 몰라도 고를 수 있게).
const PICK_SHOW = 15;
function CategoryPicker({ rows, isRent, picked, onAdd, onRemove, max }) {
  const [region, setRegion] = useState('all');
  const [dong, setDong] = useState('all');
  const [size, setSize] = useState('all');
  const [sort, setSort] = useState('volume');
  const [more, setMore] = useState(false);
  const groups = useMemo(() => categoryGroups(rows, region), [rows, region]);
  const list = useMemo(() => categoryRows(rows, { region, dong, size, sort, isRent, sizeOf: supplyPyeong }), [rows, region, dong, size, sort, isRent]);
  const shown = more ? list.slice(0, 60) : list.slice(0, PICK_SHOW);
  const pickedKeys = new Set(picked.map((p) => p.key));
  const room = max - picked.length;
  const fillTop = () => list.filter((r) => !pickedKeys.has(r.key)).slice(0, Math.max(0, room)).forEach(onAdd);
  const chip = (on) => ({
    border: `1px solid ${on ? PALETTE.accent : PALETTE.border}`, borderRadius: 999, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer',
    background: on ? PALETTE.accent : '#fff', color: on ? '#fff' : PALETTE.textSecondary, fontWeight: on ? 700 : 600, whiteSpace: 'nowrap',
  });
  const rowLabel = { fontSize: 10.5, fontWeight: 700, color: PALETTE.textMuted, minWidth: 40, paddingTop: 5 };
  const line = { display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 7 };
  const wrap = { display: 'flex', gap: 5, flexWrap: 'wrap', flex: 1, minWidth: 0 };
  const metric = (r) => {
    if (sort === 'rise') return { text: fmtPct(r.change), color: toneOf(r.change) };
    if (sort === 'drop') return { text: `고점 대비 ${fmtPct(r.drawdown)}`, color: PALETTE.down };
    const u = compareUnitOf(r, isRent, supplyPyeong);
    return { text: u ? `평당 ${fmtManwon(Math.round(u))}` : '-', color: PALETTE.textPrimary };
  };
  if (!rows || rows.length === 0) {
    return <p style={{ fontSize: 12, color: PALETTE.textMuted, margin: '0 0 10px' }}>위에서 지역을 추가하면 그 지역 단지를 카테고리로 골라 담을 수 있어요.</p>;
  }
  return (
    <div data-compare-picker="1" style={{ border: `1px solid ${PALETTE.border}`, borderRadius: 12, padding: '10px 12px', marginBottom: 12, background: PALETTE.panelAlt }}>
      <div style={line}>
        <span style={rowLabel}>지역</span>
        <div style={wrap}>
          <button type="button" style={chip(region === 'all')} onClick={() => { setRegion('all'); setDong('all'); }}>전체</button>
          {groups.regions.map((g) => (
            <button key={g.key} type="button" data-pick-region={g.key} style={chip(region === g.key)} onClick={() => { setRegion(g.key); setDong('all'); }}>
              {labelFor(g.key)} <span style={{ opacity: 0.7 }}>{g.n}</span>
            </button>
          ))}
        </div>
      </div>
      {region !== 'all' && groups.dongs.length > 1 && (
        <div style={line}>
          <span style={rowLabel}>동</span>
          <div style={{ ...wrap, maxHeight: 64, overflowY: 'auto' }}>
            <button type="button" style={chip(dong === 'all')} onClick={() => setDong('all')}>전체</button>
            {groups.dongs.map((g) => (
              <button key={g.key} type="button" data-pick-dong={g.key} style={chip(dong === g.key)} onClick={() => setDong(g.key)}>{g.key} <span style={{ opacity: 0.7 }}>{g.n}</span></button>
            ))}
          </div>
        </div>
      )}
      <div style={line}>
        <span style={rowLabel}>평형</span>
        <div style={wrap}>
          {COMPARE_SIZES.map((s) => <button key={s.key} type="button" style={chip(size === s.key)} onClick={() => setSize(s.key)}>{s.label}</button>)}
        </div>
      </div>
      <div style={line}>
        <span style={rowLabel}>기준</span>
        <div style={wrap}>
          {COMPARE_SORTS.map((s) => <button key={s.key} type="button" data-pick-sort={s.key} style={chip(sort === s.key)} onClick={() => setSort(s.key)}>{s.label}</button>)}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 6px' }}>
        <span style={{ fontSize: 11.5, color: PALETTE.textSecondary, flex: 1 }}>{list.length.toLocaleString()}개 단지{list.length > 0 && (sort === 'volume' ? ' · 거래 많은 순' : '')}</span>
        {list.length > 0 && room > 0 && (
          <button type="button" data-pick-fill="1" style={pill(true)} onClick={fillTop}>위에서 {Math.min(room, list.filter((r) => !pickedKeys.has(r.key)).length)}개 한 번에 담기</button>
        )}
      </div>
      {list.length === 0 ? (
        <p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: '4px 0' }}>
          조건에 맞는 단지가 없어요.{sort !== 'volume' && sort !== 'unit' ? ' 같은 평형 거래가 3건 이상인 단지만 나와요 — 분석기간을 늘려 보세요.' : ''}
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
          {shown.map((r) => {
            const on = pickedKeys.has(r.key);
            const m = metric(r);
            return (
              <button key={r.key} type="button" data-pick-row="1" disabled={!on && room <= 0}
                onClick={() => (on ? onRemove(r.key) : onAdd(r))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', padding: '7px 9px', borderRadius: 9, cursor: !on && room <= 0 ? 'not-allowed' : 'pointer',
                  border: `1.5px solid ${on ? PALETTE.accent : PALETTE.border}`, background: on ? PALETTE.accentSoft : '#fff', opacity: !on && room <= 0 ? 0.55 : 1,
                }}>
                <span style={{
                  width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800,
                  border: `1.5px solid ${on ? PALETTE.accent : PALETTE.borderStrong}`, background: on ? PALETTE.accent : '#fff', color: '#fff',
                }}>{on ? '✓' : ''}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: PALETTE.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.newHigh && (r.sameN || 0) >= 3 ? '🔺 ' : ''}{r.apt}
                  </span>
                  <span style={{ display: 'block', fontSize: 10.5, color: PALETTE.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {region === 'all' ? `${labelFor(r.regionCode)} ` : ''}{r.dong} · {supplyPyeong(r.area)}평 {fmtWon(r.latest)} · {r.volume}건
                  </span>
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: m.color, whiteSpace: 'nowrap' }}>{m.text}</span>
              </button>
            );
          })}
        </div>
      )}
      {list.length > PICK_SHOW && (
        <button type="button" onClick={() => setMore((v) => !v)}
          style={{ marginTop: 8, border: 'none', background: 'transparent', color: PALETTE.accentDark, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
          {more ? '접기' : `더 보기 (${Math.min(list.length, 60) - PICK_SHOW}개 더)`}
        </button>
      )}
    </div>
  );
}

// v247: 시장분석 탭 "단지 비교"·"지역 비교"(아실·호갱노노식).
//  - 단지 비교: 조회한 지역의 단지 중 2~5개를 골라(비교함 단지도 한 번에) 분석기간 요약표 + 1~10년 평당가 추이(LongCompare).
//  - 지역 비교: 시장분석에 추가한 지역들을 분석기간 거래로 나란히(평당가·거래·변화·신고가) + 장기 추이.
const MAX = 8; // v280: 5 → 8(그래프 색은 LINE_COLORS 8색)

const pill = (on) => ({
  border: 'none', borderRadius: 999, padding: '6px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
  background: on ? PALETTE.accent : PALETTE.accentSoft, color: on ? '#fff' : PALETTE.accentDark, fontWeight: 700,
});
const toneOf = (v) => (v > 0 ? PALETTE.up : v < 0 ? PALETTE.down : PALETTE.textPrimary);

function ComplexCompare({ rows, tx, isRent, pinnedComplexes, setSelectedApt, styles }) {
  const [picked, setPicked] = useState([]); // [{ key, apt, dong, regionCode }]
  const [query, setQuery] = useState('');
  const [pickMode, setPickMode] = useState('category'); // v280: 'category' | 'search'
  const rowByKey = useMemo(() => new Map((rows || []).map((r) => [r.key, r])), [rows]);
  const hits = useMemo(() => searchRows(rows, query, 8).filter((r) => !picked.some((p) => p.key === r.key)), [rows, query, picked]);
  const add = (c) => setPicked((prev) => (prev.length >= MAX || prev.some((p) => p.key === c.key) ? prev : [...prev, c]));
  const keyOf = (c) => `${c.regionCode}|${c.dong}|${c.apt}`;
  const addPinned = () => (pinnedComplexes || []).forEach((p) => add({ key: keyOf(p), apt: p.apt, dong: p.dong, regionCode: p.regionCode }));
  const labels = complexLabels(picked);
  const items = picked.map((c, i) => ({ kind: 'complex', label: labels[i], regionCode: c.regionCode, apt: c.apt, dong: c.dong }));

  return (
    <div style={styles.card} className="ui-card" data-market-compare="complexes">
      <h2 style={styles.sectionTitle}>단지 비교</h2>
      <p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: '-6px 0 12px' }}>
        조회한 지역의 단지 중 최대 {MAX}개를 골라 나란히 봐요. 표는 위 분석기간, 아래 그래프는 1~10년 평당가 추이예요.
      </p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[['category', '📂 카테고리로 고르기'], ['search', '🔍 이름으로 찾기']].map(([k, label]) => (
          <button key={k} type="button" data-pick-mode={k} onClick={() => setPickMode(k)} style={pill(pickMode === k)}>{label}</button>
        ))}
        <span style={{ alignSelf: 'center', fontSize: 11.5, color: PALETTE.textMuted, marginLeft: 'auto' }}>{picked.length}/{MAX}개 담음</span>
      </div>
      {pickMode === 'category' && (
        <CategoryPicker rows={rows} isRent={isRent} picked={picked} max={MAX}
          onAdd={(r) => add({ key: r.key, apt: r.apt, dong: r.dong, regionCode: r.regionCode })}
          onRemove={(key) => setPicked((prev) => prev.filter((p) => p.key !== key))} />
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        {pickMode === 'search' && <input
          data-compare-search="1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="단지 이름으로 찾기 (예: 헬리오)"
          style={{ ...styles.select, maxWidth: 280, fontSize: 13 }} disabled={picked.length >= MAX}
        />}
        {(pinnedComplexes || []).length > 0 && (
          <button type="button" style={pill(false)} onClick={addPinned} disabled={picked.length >= MAX}>📊 비교함 단지 넣기 ({pinnedComplexes.length})</button>
        )}
        {picked.length > 0 && <button type="button" style={{ ...pill(false), background: 'transparent', color: PALETTE.textMuted }} onClick={() => setPicked([])}>모두 빼기</button>}
      </div>
      {pickMode === 'search' && query && hits.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {hits.map((r) => (
            <button key={r.key} type="button" data-compare-hit="1" onClick={() => { add(r); setQuery(''); }}
              style={{ border: `1px solid ${PALETTE.border}`, background: '#fff', borderRadius: 10, padding: '6px 10px', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}>
              <b>{r.apt}</b> <span style={{ color: PALETTE.textMuted, fontSize: 11 }}>{labelFor(r.regionCode)} {r.dong} · {r.volume}건</span>
            </button>
          ))}
        </div>
      )}
      {pickMode === 'search' && query && hits.length === 0 &&<p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: '0 0 10px' }}>조회한 지역에서 "{query}" 단지를 못 찾았어요. 위에서 지역을 추가해 보세요.</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {picked.map((c, i) => (
          <span key={c.key} style={{ ...styles.chip, borderColor: LINE_COLORS[i % LINE_COLORS.length], color: PALETTE.textPrimary, background: '#fff' }}>
            <span style={{ width: 8, height: 8, borderRadius: 8, background: LINE_COLORS[i % LINE_COLORS.length] }} />
            {labels[i]}
            <X size={11} style={{ cursor: 'pointer' }} onClick={() => setPicked((prev) => prev.filter((p) => p.key !== c.key))} />
          </span>
        ))}
        {picked.length === 0 && <span style={{ fontSize: 12, color: PALETTE.textMuted }}>아직 고른 단지가 없어요. 위 목록에서 누르거나 이름으로 찾아 2개 이상 담아 보세요.</span>}
      </div>
      {picked.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }} data-compare-table="complexes">
            <thead><tr>{['단지', '최근 거래', '평균 평당가', '평당가 변화', '최고 평당가', '거래'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
            <tbody>
              {picked.map((c, i) => {
                const r = rowByKey.get(c.key) ? complexCompareStats(tx, c.key, isRent) : null;
                return (
                  <tr key={c.key}>
                    <td style={{ ...styles.td, cursor: 'pointer' }} onClick={() => setSelectedApt({ apt: c.apt, dong: c.dong, regionCode: c.regionCode })}>
                      <b style={{ color: LINE_COLORS[i % LINE_COLORS.length] }}>{labels[i]}</b>
                      <div style={{ fontSize: 10, color: PALETTE.textMuted }}>{labelFor(c.regionCode)} {c.dong}</div>
                    </td>
                    {r && r.count ? (
                      <>
                        <td style={styles.td}>
                          {r.latest ? fmtWon(r.latest.price) : '-'}
                          {r.latest && <div style={{ fontSize: 10, color: PALETTE.textMuted }}>{supplyPyeong(r.latest.area)}평 · {r.latest.ymd}</div>}
                        </td>
                        <td style={styles.td}>{r.avgUnit ? fmtManwon(Math.round(r.avgUnit)) : '-'}</td>
                        <td style={{ ...styles.td, color: toneOf(r.changePct) }}>{r.changePct != null ? fmtPct(r.changePct) : <span style={{ color: PALETTE.textMuted }}>표본 부족</span>}</td>
                        <td style={styles.td}>{r.maxUnit ? fmtManwon(Math.round(r.maxUnit)) : '-'}</td>
                        <td style={styles.td}>{r.count}건</td>
                      </>
                    ) : (
                      <td colSpan={5} style={{ ...styles.td, color: PALETTE.textMuted }}>분석기간에 거래가 없어요 (아래 장기 추이는 나와요)</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ fontSize: 10, color: PALETTE.textMuted, margin: '6px 0 0' }}>
            평형이 섞여도 왜곡되지 않게 평당가로 비교해요. 평당가 변화 = 분석기간 앞 절반 → 뒤 절반 평균(양쪽 2건 이상). 같은 평형대끼리는 아래 그래프에서 비교하세요.
          </p>
        </div>
      )}
      <LongCompare items={items} isRent={isRent} />
    </div>
  );
}

function RegionCompare({ tx, rows, isRent, selected, styles }) {
  const table = useMemo(() => regionCompareRows(tx, rows, isRent), [tx, rows, isRent]);
  const longItems = (selected || []).filter((c) => !/000$/.test(String(c))).slice(0, MAX).map((code) => ({ kind: 'region', label: labelFor(code), code }));
  const maxUnit = Math.max(1, ...table.map((r) => r.avgUnit || 0));
  return (
    <div style={styles.card} className="ui-card" data-market-compare="regions">
      <h2 style={styles.sectionTitle}>지역 비교</h2>
      <p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: '-6px 0 12px' }}>
        위에서 추가한 지역들을 분석기간 실거래로 나란히 봐요. 2곳 이상 추가하면 비교가 돼요. {isRent ? '전세 보증금' : '매매'} 기준이에요.
      </p>
      {table.length === 0 ? (
        <p style={{ fontSize: 13, color: PALETTE.textMuted }}>분석기간에 거래가 없어요. 지역을 추가하거나 기간을 늘려 보세요.</p>
      ) : (
        <div style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }} data-compare-table="regions">
            <thead><tr>{['지역', '평균 평당가', '중위 거래가', '평당가 변화', '거래', '단지', '신고가 단지'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
            <tbody>
              {table.map((r) => (
                <tr key={r.code}>
                  <td style={{ ...styles.td, fontWeight: 700 }}>{labelFor(r.code)}</td>
                  <td style={styles.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ minWidth: 64 }}>{r.avgUnit ? fmtManwon(Math.round(r.avgUnit)) : '-'}</span>
                      <span style={{ flex: 1, minWidth: 40, height: 6, background: PALETTE.panelAlt, borderRadius: 4 }}>
                        <span style={{ display: 'block', height: '100%', width: `${((r.avgUnit || 0) / maxUnit) * 100}%`, background: PALETTE.accent, borderRadius: 4 }} />
                      </span>
                    </div>
                  </td>
                  <td style={styles.td}>{fmtWon(r.medianPrice)}</td>
                  <td style={{ ...styles.td, color: toneOf(r.changePct) }}>{r.changePct != null ? fmtPct(r.changePct) : <span style={{ color: PALETTE.textMuted }}>표본 부족</span>}</td>
                  <td style={styles.td}>{r.count.toLocaleString()}건</td>
                  <td style={styles.td}>{r.complexes.toLocaleString()}곳</td>
                  <td style={styles.td}>{r.highs}곳</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 10, color: PALETTE.textMuted, margin: '6px 0 0' }}>
            평당가 변화 = 분석기간 앞 절반 → 뒤 절반 평균 평당가(양쪽 5건 이상일 때). 신고가 단지 = 기간 마지막 거래가 그 기간 최고가인 단지.
          </p>
        </div>
      )}
      {longItems.length > 0 && <LongCompare items={longItems} isRent={isRent} />}
      {(selected || []).some((c) => /000$/.test(String(c))) && (
        <p style={{ fontSize: 10.5, color: PALETTE.textMuted }}>시·도 전체는 장기 추이에서 빠져요(자료가 너무 많아요). 구·시를 추가하면 함께 나와요.</p>
      )}
    </div>
  );
}

export default function MarketCompare({ view, ...props }) {
  return view === 'regions' ? <RegionCompare {...props} /> : <ComplexCompare {...props} />;
}

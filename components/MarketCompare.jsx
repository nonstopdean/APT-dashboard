'use client';

import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  PALETTE, LINE_COLORS, fmtPct, fmtWon, fmtManwon, labelFor,
} from '../lib/ui-helpers';
import { regionCompareRows, searchRows, complexLabels } from '../lib/market-compare';
import LongCompare from './LongCompare';

// v247: 시장분석 탭 "단지 비교"·"지역 비교"(아실·호갱노노식).
//  - 단지 비교: 조회한 지역의 단지 중 2~5개를 골라(비교함 단지도 한 번에) 분석기간 요약표 + 1~10년 평당가 추이(LongCompare).
//  - 지역 비교: 시장분석에 추가한 지역들을 분석기간 거래로 나란히(평당가·거래·변화·신고가) + 장기 추이.
const MAX = 5;

const pill = (on) => ({
  border: 'none', borderRadius: 999, padding: '6px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
  background: on ? PALETTE.accent : PALETTE.accentSoft, color: on ? '#fff' : PALETTE.accentDark, fontWeight: 700,
});
const toneOf = (v) => (v > 0 ? PALETTE.up : v < 0 ? PALETTE.down : PALETTE.textPrimary);

function ComplexCompare({ rows, isRent, pinnedComplexes, setSelectedApt, styles }) {
  const [picked, setPicked] = useState([]); // [{ key, apt, dong, regionCode }]
  const [query, setQuery] = useState('');
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
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <input
          data-compare-search="1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="단지 이름으로 찾기 (예: 헬리오)"
          style={{ ...styles.select, maxWidth: 280, fontSize: 13 }} disabled={picked.length >= MAX}
        />
        {(pinnedComplexes || []).length > 0 && (
          <button type="button" style={pill(false)} onClick={addPinned} disabled={picked.length >= MAX}>📊 비교함 단지 넣기 ({pinnedComplexes.length})</button>
        )}
        {picked.length > 0 && <button type="button" style={{ ...pill(false), background: 'transparent', color: PALETTE.textMuted }} onClick={() => setPicked([])}>모두 빼기</button>}
      </div>
      {query && hits.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {hits.map((r) => (
            <button key={r.key} type="button" data-compare-hit="1" onClick={() => { add(r); setQuery(''); }}
              style={{ border: `1px solid ${PALETTE.border}`, background: '#fff', borderRadius: 10, padding: '6px 10px', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}>
              <b>{r.apt}</b> <span style={{ color: PALETTE.textMuted, fontSize: 11 }}>{labelFor(r.regionCode)} {r.dong} · {r.volume}건</span>
            </button>
          ))}
        </div>
      )}
      {query && hits.length === 0 && <p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: '0 0 10px' }}>조회한 지역에서 "{query}" 단지를 못 찾았어요. 위에서 지역을 추가해 보세요.</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {picked.map((c, i) => (
          <span key={c.key} style={{ ...styles.chip, borderColor: LINE_COLORS[i % LINE_COLORS.length], color: PALETTE.textPrimary, background: '#fff' }}>
            <span style={{ width: 8, height: 8, borderRadius: 8, background: LINE_COLORS[i % LINE_COLORS.length] }} />
            {labels[i]}
            <X size={11} style={{ cursor: 'pointer' }} onClick={() => setPicked((prev) => prev.filter((p) => p.key !== c.key))} />
          </span>
        ))}
        {picked.length === 0 && <span style={{ fontSize: 12, color: PALETTE.textMuted }}>아직 고른 단지가 없어요. 이름으로 찾아 2개 이상 골라 보세요.</span>}
      </div>
      {picked.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }} data-compare-table="complexes">
            <thead><tr>{['단지', '최근가', '평당가', '기간 변동', '거래', '고점 대비'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
            <tbody>
              {picked.map((c, i) => {
                const r = rowByKey.get(c.key);
                return (
                  <tr key={c.key}>
                    <td style={{ ...styles.td, cursor: 'pointer' }} onClick={() => setSelectedApt({ apt: c.apt, dong: c.dong, regionCode: c.regionCode })}>
                      <b style={{ color: LINE_COLORS[i % LINE_COLORS.length] }}>{labels[i]}</b>
                      <div style={{ fontSize: 10, color: PALETTE.textMuted }}>{labelFor(c.regionCode)} {c.dong}</div>
                    </td>
                    {r ? (
                      <>
                        <td style={styles.td}>{fmtWon(r.latest)}</td>
                        <td style={styles.td}>{r.unitPrice ? fmtManwon(Math.round(r.unitPrice)) : '-'}</td>
                        <td style={{ ...styles.td, color: toneOf(r.change) }}>{r.change != null ? fmtPct(r.change) : '-'}</td>
                        <td style={styles.td}>{r.volume}건</td>
                        <td style={{ ...styles.td, color: r.drawdown < 0 ? PALETTE.down : PALETTE.textSecondary }}>{r.drawdown != null ? fmtPct(r.drawdown) : '-'}</td>
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
            기간 변동은 분석기간 첫 거래 → 마지막 거래(평형 섞임), 고점 대비는 기간 최고가 대비예요. 같은 평형끼리는 아래 그래프에서 비교하세요.
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

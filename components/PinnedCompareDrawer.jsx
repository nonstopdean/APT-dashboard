import React, { useState } from 'react';
import { X } from 'lucide-react';
import { PALETTE, fmtPct, fmtManwon, labelFor } from '../lib/ui-helpers';
import { buildCompareGrid, pinnedKeyOf, MAX_PINNED } from '../lib/compare-grid';

// 지도 탭 안에서 바로 보이는 "비교함" — 비교분석 탭으로 안 가도 담아둔 단지를 비교할 수 있게 한다.
// pinnedComplexes 자체는 page.jsx의 기존 상태를 그대로 쓰고, 이 컴포넌트는 그 내용을 지도 위
// 작은 서랍으로 보여주기만 한다.
export default function PinnedCompareDrawer({
  pinnedComplexes, setPinnedComplexes, complexCompare, setSelectedApt, isRent,
  onFocusMap, onOpenCompareTab,
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('list'); // 'list' | 'grid'
  if (pinnedComplexes.length === 0) return null;

  const grid = view === 'grid' ? buildCompareGrid(pinnedComplexes, complexCompare, { isRent }) : null;
  const toneColor = (tone) => (tone === 'up' ? PALETTE.up : tone === 'down' ? PALETTE.down : PALETTE.textPrimary);
  const smallBtn = (active) => ({
    border: `1px solid ${active ? PALETTE.accent : PALETTE.border}`, background: active ? PALETTE.accent : 'transparent',
    color: active ? '#fff' : PALETTE.textSecondary, borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
  });
  const actionBtn = {
    flex: 1, border: `1px solid ${PALETTE.border}`, background: PALETTE.panelAlt, color: PALETTE.textPrimary,
    borderRadius: 8, padding: '7px 8px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  };

  return (
    <div className="pcd-root" style={{ position: 'absolute', left: 14, bottom: 78, zIndex: 21, pointerEvents: 'none' }}>
      {open && (
        <div
          style={{
            pointerEvents: 'auto', marginBottom: 8, maxHeight: 360, overflowY: 'auto',
            width: view === 'grid' ? `min(${Math.max(360, 96 + 108 * pinnedComplexes.length)}px, calc(100vw - 28px))` : 320,
            background: 'rgba(255,255,255,0.98)', border: `1px solid ${PALETTE.border}`, borderRadius: 14,
            boxShadow: '0 8px 28px rgba(0,0,0,0.14)', backdropFilter: 'blur(10px)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: `1px solid ${PALETTE.border}` }}>
            <span style={{ fontSize: 13, fontWeight: 800 }}>비교함 ({pinnedComplexes.length}/{MAX_PINNED})</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button type="button" data-view="list" className="pcd-btn" style={smallBtn(view === 'list')} onClick={() => setView('list')}>목록</button>
              <button type="button" data-view="grid" className="pcd-btn" style={smallBtn(view === 'grid')} onClick={() => setView('grid')}>표</button>
              <span style={{ fontSize: 11, color: PALETTE.accent, cursor: 'pointer', marginLeft: 4 }} onClick={() => setPinnedComplexes([])}>전체 비우기</span>
            </div>
          </div>
          {view === 'grid' && grid && (
            <div style={{ overflowX: 'auto' }} data-grid="1">
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11.5 }}>
                <thead>
                  <tr>
                    <th style={{ position: 'sticky', left: 0, background: 'rgba(255,255,255,0.98)', padding: '8px 10px', textAlign: 'left', color: PALETTE.textMuted, fontWeight: 600, fontSize: 10.5 }}>항목</th>
                    {grid.columns.map((c, i) => (
                      <th
                        key={c.key} data-col={c.key}
                        onClick={() => setSelectedApt(pinnedComplexes[i])}
                        style={{ padding: '8px 10px', textAlign: 'right', minWidth: 96, cursor: 'pointer', verticalAlign: 'top' }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>{c.apt}</div>
                        <div style={{ fontSize: 10, fontWeight: 500, color: PALETTE.textMuted }}>{c.region} {c.dong}</div>
                        {!c.hasData && <div style={{ fontSize: 10, color: PALETTE.textMuted }}>(조회 기간 거래 없음)</div>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.rows.map((r) => (
                    <tr key={r.id} data-row={r.id} style={{ borderTop: `1px solid ${PALETTE.border}` }}>
                      <td style={{ position: 'sticky', left: 0, background: 'rgba(255,255,255,0.98)', padding: '8px 10px', color: PALETTE.textMuted, fontSize: 10.5, whiteSpace: 'nowrap' }}>{r.label}</td>
                      {r.cells.map((cell, i) => (
                        <td key={grid.columns[i].key} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: toneColor(cell.tone) }}>
                          {cell.text}
                          {cell.badge && (
                            <div><span data-badge="1" style={{ display: 'inline-block', marginTop: 2, padding: '1px 6px', borderRadius: 999, fontSize: 9.5, fontWeight: 700, background: PALETTE.panelAlt, color: PALETTE.accent, border: `1px solid ${PALETTE.border}` }}>{cell.badge}</span></div>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: '6px 12px 8px', fontSize: 10, color: PALETTE.textMuted, lineHeight: 1.5 }}>
                배지는 평당가처럼 같은 기준으로 비교되는 항목에만 달아요. "기간 내 변동"은 조회 기간 안에서 처음 거래 대비 최근 거래의 평당가 변화예요(연간 변동이 아니에요).
              </div>
            </div>
          )}
          {view === 'list' && pinnedComplexes.map((p) => {
            const row = complexCompare.find((c) => c.apt === p.apt && c.dong === p.dong && c.regionCode === p.regionCode);
            return (
              <div
                key={`${p.regionCode}|${p.dong}|${p.apt}`}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', borderBottom: `1px solid ${PALETTE.border}`, cursor: 'pointer' }}
                onClick={() => setSelectedApt(p)}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.apt}</div>
                  <div style={{ fontSize: 10, color: PALETTE.textMuted }}>{labelFor(p.regionCode)} {p.dong}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{row ? fmtManwon(isRent ? row.deposit : row.amount) : '-'}</div>
                    {row && <div style={{ fontSize: 10, color: row.change > 0 ? PALETTE.up : row.change < 0 ? PALETTE.down : PALETTE.textMuted }}>{fmtPct(row.change)}</div>}
                  </div>
                  <X
                    size={13}
                    color={PALETTE.textMuted}
                    onClick={(e) => { e.stopPropagation(); setPinnedComplexes((prev) => prev.filter((x) => !(x.apt === p.apt && x.dong === p.dong && x.regionCode === p.regionCode))); }}
                  />
                </div>
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 6, padding: '8px 10px', position: 'sticky', bottom: 0, background: 'rgba(255,255,255,0.98)', borderTop: `1px solid ${PALETTE.border}` }}>
            {onFocusMap && <button type="button" data-action="focus" className="pcd-btn" style={actionBtn} onClick={() => onFocusMap(pinnedComplexes.map(pinnedKeyOf))}>지도에서 이 단지들만 보기</button>}
            {onOpenCompareTab && <button type="button" data-action="tab" className="pcd-btn" style={actionBtn} onClick={() => onOpenCompareTab()}>비교분석 탭에서 자세히</button>}
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          pointerEvents: 'auto', border: `1px solid ${PALETTE.border}`, borderRadius: 12,
          padding: '9px 14px', background: open ? PALETTE.accent : 'rgba(255,255,255,0.96)',
          boxShadow: '0 4px 18px rgba(0,0,0,0.10)', fontSize: 12.5, fontWeight: 700,
          color: open ? '#fff' : PALETTE.textPrimary, cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        📊 비교함 ({pinnedComplexes.length})
      </button>
    </div>
  );
}

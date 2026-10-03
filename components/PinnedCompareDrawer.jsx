import React, { useState } from 'react';
import { X } from 'lucide-react';
import { PALETTE, fmtPct, fmtManwon, labelFor } from '../lib/ui-helpers';

// 지도 탭 안에서 바로 보이는 "비교함" — 비교분석 탭으로 안 가도 담아둔 단지를 비교할 수 있게 한다.
// pinnedComplexes 자체는 page.jsx의 기존 상태를 그대로 쓰고, 이 컴포넌트는 그 내용을 지도 위
// 작은 서랍으로 보여주기만 한다.
export default function PinnedCompareDrawer({
  pinnedComplexes, setPinnedComplexes, complexCompare, setSelectedApt, isRent,
}) {
  const [open, setOpen] = useState(false);
  if (pinnedComplexes.length === 0) return null;

  return (
    <div style={{ position: 'absolute', left: 14, bottom: 78, zIndex: 21, pointerEvents: 'none' }}>
      {open && (
        <div
          style={{
            pointerEvents: 'auto', marginBottom: 8, width: 320, maxHeight: 320, overflowY: 'auto',
            background: 'rgba(255,255,255,0.98)', border: `1px solid ${PALETTE.border}`, borderRadius: 14,
            boxShadow: '0 8px 28px rgba(0,0,0,0.14)', backdropFilter: 'blur(10px)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: `1px solid ${PALETTE.border}` }}>
            <span style={{ fontSize: 13, fontWeight: 800 }}>비교함 ({pinnedComplexes.length}/5)</span>
            <span style={{ fontSize: 11, color: PALETTE.accent, cursor: 'pointer' }} onClick={() => setPinnedComplexes([])}>전체 비우기</span>
          </div>
          {pinnedComplexes.map((p) => {
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

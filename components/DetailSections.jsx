'use client';

import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { PALETTE } from '../lib/ui-helpers';

// 단지 상세(패널)의 본문을 주제별 섹션으로 묶어서 보여준다.
//  - 위쪽에 고정되는 줄: 핵심 요약 + 섹션으로 바로 이동하는 칩(스크롤해도 계속 보인다).
//  - 섹션은 접고 펼 수 있고, 어떻게 해뒀는지 브라우저에 기억한다.
//  - 보여줄 내용이 하나도 없는 섹션(예: 주변시설 정보가 아예 없을 때)은 칩과 함께 빠진다.
// 본문 덩어리(blocks)의 내용은 ComplexDetail이 만든 그대로이고, 여기서는 묶어서 배치만 한다.
const STORAGE_KEY = 'aptDetailSections.v1';

function loadOpenMap() {
  if (typeof window === 'undefined') return {};
  try {
    const v = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    return v && typeof v === 'object' ? v : {};
  } catch (e) {
    return {};
  }
}

const sectionDomId = (id) => `detail-sec-${id}`;
const STICKY_OFFSET = 84; // 고정 줄에 가려지지 않게 이동 위치를 이만큼 띄운다

export default function DetailSections({ summaryLine, sections }) {
  const visible = sections.filter((s) => s.blocks.some(Boolean));
  const [openMap, setOpenMap] = useState(loadOpenMap);
  const isOpen = (s) => (s.id in openMap ? !!openMap[s.id] : !!s.defaultOpen);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(openMap)); } catch (e) { /* 저장이 안 돼도(시크릿 모드 등) 동작에는 문제없다 */ }
  }, [openMap]);

  const setOpen = (id, value) => setOpenMap((m) => ({ ...m, [id]: value }));

  const jump = (s) => {
    if (!isOpen(s)) setOpen(s.id, true);
    // 접혀 있던 섹션은 펼쳐진 뒤의 위치로 이동해야 하므로 한 프레임 기다린다.
    const go = () => {
      const el = typeof document !== 'undefined' ? document.getElementById(sectionDomId(s.id)) : null;
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    if (typeof window !== 'undefined' && window.requestAnimationFrame) window.requestAnimationFrame(go); else go();
  };

  return (
    <>
      <div
        data-ds="nav"
        style={{
          position: 'sticky', top: 0, zIndex: 3, margin: '0 -20px 12px', padding: '8px 20px 8px',
          background: PALETTE.panel, borderBottom: `1px solid ${PALETTE.border}`,
        }}
      >
        {summaryLine && <div style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 6 }}>{summaryLine}</div>}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {visible.map((s) => (
            <button
              key={s.id} type="button" data-ds="chip" className="ds-chip" onClick={() => jump(s)}
              style={{
                flexShrink: 0, border: `1px solid ${PALETTE.border}`, background: PALETTE.panelAlt, color: PALETTE.textSecondary,
                borderRadius: 999, padding: '4px 11px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {s.title}
            </button>
          ))}
        </div>
      </div>

      {visible.map((s) => {
        const open = isOpen(s);
        return (
          <section key={s.id} id={sectionDomId(s.id)} style={{ marginBottom: 14, scrollMarginTop: STICKY_OFFSET }}>
            <button
              type="button" data-ds="header" className="ds-header" aria-expanded={open} onClick={() => setOpen(s.id, !open)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left',
                border: 'none', borderBottom: `1px solid ${PALETTE.border}`, background: 'transparent',
                padding: '6px 0', marginBottom: open ? 12 : 0, cursor: 'pointer', color: PALETTE.textPrimary,
              }}
            >
              {open ? <ChevronDown size={15} color={PALETTE.textMuted} /> : <ChevronRight size={15} color={PALETTE.textMuted} />}
              <span style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '-0.01em' }}>{s.title}</span>
            </button>
            {open && (
              <div>
                {s.blocks.map((b, i) => <React.Fragment key={i}>{b}</React.Fragment>)}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

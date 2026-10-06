'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Minus, Maximize2, RotateCcw, GripHorizontal } from 'lucide-react';
import { PALETTE, HEADER_HEIGHT } from '../lib/ui-helpers';
import {
  BAR_H, DEFAULT_W, NARROW_MAX,
  clampLayout, dockedLayout, resizeRect, snapIfNearDock, rightInset, onViewportResize, isDockedRight, isFullHeight,
} from '../lib/window-layout';

// 지도 위에 떠서 옮기고(제목줄 드래그) 크기를 바꾸고(가장자리·모서리 드래그) 최소화할 수 있는 창.
// - 제목줄은 스크롤과 분리돼 항상 보이고, 본문만 스크롤된다.
// - 창은 항상 화면 안·상단 헤더 아래에만 있어서(lib/window-layout.js) 어떤 조작으로도 잘리지 않는다.
// - 위치·크기·최소화 상태는 브라우저에 기억한다.
// - 좁은 화면(모바일)에서는 이동·크기조절 없이 아래쪽 시트로 보여주고, 스크롤·최소화·닫기만 쓴다.
const STORAGE_KEY = 'aptDetailWindow.v1';

const viewportNow = () => ({ vw: window.innerWidth, vh: window.innerHeight });

function readSaved() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function initialLayout(top) {
  if (typeof window === 'undefined') return { x: 0, y: top, w: DEFAULT_W, h: 600, minimized: false };
  const { vw, vh } = viewportNow();
  const saved = readSaved();
  if (saved && typeof saved === 'object') {
    // 오른쪽에 붙어 있었으면 다시 붙이고, 높이를 가득 쓰고 있었으면 지금 화면 높이에 맞춰 가득 쓴다.
    const l = { ...saved };
    if (saved.dockedRight && Number.isFinite(saved.w)) l.x = vw - saved.w;
    if (saved.fullHeight) l.h = vh - top;
    return clampLayout(l, vw, vh, top);
  }
  return dockedLayout(DEFAULT_W, vw, vh, top);
}

const EDGE = 6;
const CORNER = 14;
const HANDLES = [
  ['w', { left: 0, top: CORNER, bottom: CORNER, width: EDGE, cursor: 'ew-resize' }],
  ['e', { right: 0, top: CORNER, bottom: CORNER, width: EDGE, cursor: 'ew-resize' }],
  ['n', { top: 0, left: CORNER, right: CORNER, height: EDGE, cursor: 'ns-resize' }],
  ['s', { bottom: 0, left: CORNER, right: CORNER, height: EDGE, cursor: 'ns-resize' }],
  ['nw', { left: 0, top: 0, width: CORNER, height: CORNER, cursor: 'nwse-resize' }],
  ['ne', { right: 0, top: 0, width: CORNER, height: CORNER, cursor: 'nesw-resize' }],
  ['sw', { left: 0, bottom: 0, width: CORNER, height: CORNER, cursor: 'nesw-resize' }],
  ['se', { right: 0, bottom: 0, width: CORNER, height: CORNER, cursor: 'nwse-resize' }],
];

const iconBtn = {
  width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', color: PALETTE.textMuted, padding: 0, flexShrink: 0,
};

export default function FloatingWindow({
  title, onClose, onInsetChange, children, topOffset = HEADER_HEIGHT,
}) {
  const [vp, setVp] = useState(() => (typeof window === 'undefined' ? { vw: 1440, vh: 900 } : viewportNow()));
  const [layout, setLayout] = useState(() => initialLayout(topOffset));
  const layoutRef = useRef(layout);
  const vpRef = useRef(vp);
  const dragRef = useRef(null);
  layoutRef.current = layout;
  vpRef.current = vp;

  const narrow = vp.vw <= NARROW_MAX;

  // 브라우저 창 크기가 바뀌면 화면 안으로 다시 맞춘다.
  useEffect(() => {
    const onResize = () => {
      const old = vpRef.current;
      const next = viewportNow();
      setVp(next);
      setLayout((l) => onViewportResize(l, old.vw, old.vh, next.vw, next.vh, topOffset));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [topOffset]);

  // 위치·크기를 기억한다(드래그 중 매번 쓰지 않게 잠깐 멈춘 뒤 저장). 좁은 화면은 데스크톱 설정을 덮어쓰지 않는다.
  useEffect(() => {
    if (narrow) return undefined;
    const id = setTimeout(() => {
      try {
        const { vw, vh } = vpRef.current;
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          ...layout, dockedRight: isDockedRight(layout, vw), fullHeight: isFullHeight(layout, vh, topOffset),
        }));
      } catch (e) {
        // 저장이 안 돼도(시크릿 모드 등) 창은 정상 동작한다.
      }
    }, 250);
    return () => clearTimeout(id);
  }, [layout, narrow, topOffset]);

  // 지도 툴바가 비켜줄 폭을 부모에 알린다 — 오른쪽에 붙어 있을 때만 창 폭, 아니면 0.
  const inset = rightInset(layout, vp.vw, narrow);
  useEffect(() => {
    if (onInsetChange) onInsetChange(inset);
  }, [inset, onInsetChange]);

  const setSelectable = (on) => { try { document.body.style.userSelect = on ? '' : 'none'; } catch (e) { /* noop */ } };

  const beginMove = (e) => {
    if (narrow || e.button !== 0 || (e.target.closest && e.target.closest('[data-nodrag]'))) return;
    dragRef.current = { kind: 'move', px: e.clientX, py: e.clientY, start: layoutRef.current, el: e.currentTarget, id: e.pointerId };
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
    setSelectable(false);
  };
  const beginResize = (edge) => (e) => {
    if (narrow || e.button !== 0) return;
    e.stopPropagation();
    dragRef.current = { kind: 'resize', edge, px: e.clientX, py: e.clientY, start: layoutRef.current, el: e.currentTarget, id: e.pointerId };
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
    setSelectable(false);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    const { vw, vh } = vpRef.current;
    if (d.kind === 'move') {
      setLayout(clampLayout({ ...d.start, x: d.start.x + dx, y: d.start.y + dy }, vw, vh, topOffset));
    } else {
      setLayout({ ...resizeRect(d.start, d.edge, dx, dy, vw, vh, topOffset), minimized: false });
    }
  };
  const endPointer = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    try { if (d.el.releasePointerCapture) d.el.releasePointerCapture(d.id); } catch (err) { /* noop */ }
    setSelectable(true);
    if (d.kind === 'move') {
      const { vw, vh } = vpRef.current;
      setLayout((l) => snapIfNearDock(l, vw, vh, topOffset)); // 오른쪽 위 모서리 근처에 놓으면 기본 위치로 붙는다
    }
  };

  const toggleMinimized = () => setLayout((l) => clampLayout({ ...l, minimized: !l.minimized }, vpRef.current.vw, vpRef.current.vh, topOffset));
  const resetPosition = () => setLayout(dockedLayout(DEFAULT_W, vpRef.current.vw, vpRef.current.vh, topOffset));

  const docked = isDockedRight(layout, vp.vw);
  const atTop = layout.y <= topOffset + 1;
  const fullDocked = !narrow && docked && isFullHeight(layout, vp.vh, topOffset);
  const eh = layout.minimized ? BAR_H : layout.h;

  const rootStyle = narrow
    ? {
      position: 'fixed', left: 8, right: 8, bottom: 8,
      height: layout.minimized ? BAR_H : '62vh', maxHeight: `calc(100vh - ${topOffset + 16}px)`,
    }
    : { position: 'fixed', left: layout.x, top: layout.y, width: layout.w, height: eh };

  return (
    <div
      role="dialog"
      aria-label={typeof title === 'string' ? title : '단지 상세'}
      style={{
        ...rootStyle, zIndex: 40, display: 'flex', flexDirection: 'column',
        background: PALETTE.panel, border: `1px solid ${PALETTE.border}`,
        borderRadius: fullDocked ? 0 : 12, boxShadow: '0 10px 32px rgba(0,0,0,0.20)', overflow: 'hidden',
      }}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
    >
      <div
        onPointerDown={beginMove}
        onDoubleClick={(e) => { if (!(e.target.closest && e.target.closest('[data-nodrag]'))) toggleMinimized(); }}
        style={{
          height: BAR_H, flex: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 0 12px',
          background: PALETTE.panelAlt, borderBottom: layout.minimized ? 'none' : `1px solid ${PALETTE.border}`,
          cursor: narrow ? 'default' : 'grab', userSelect: 'none', touchAction: 'none',
        }}
      >
        {!narrow && <GripHorizontal size={14} color={PALETTE.textMuted} style={{ flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 800, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </div>
        {!narrow && (
          <button type="button" data-nodrag className="fw-btn" style={iconBtn} onClick={resetPosition} title="기본 위치로 되돌리기" aria-label="기본 위치로 되돌리기">
            <RotateCcw size={15} />
          </button>
        )}
        <button
          type="button" data-nodrag className="fw-btn" style={iconBtn} onClick={toggleMinimized}
          title={layout.minimized ? '펼치기' : '최소화 (제목줄 더블클릭)'} aria-label={layout.minimized ? '펼치기' : '최소화'}
        >
          {layout.minimized ? <Maximize2 size={15} /> : <Minus size={16} />}
        </button>
        <button type="button" data-nodrag className="fw-btn" style={iconBtn} onClick={onClose} title="닫기" aria-label="닫기">
          <X size={17} />
        </button>
      </div>

      {!layout.minimized && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '14px 20px 24px' }}>
          {children}
        </div>
      )}

      {!narrow && !layout.minimized && HANDLES.map(([edge, pos]) => {
        // 더 움직일 수 없는 쪽(오른쪽에 붙어 있을 때의 오른쪽 등)은 핸들을 빼서 스크롤바를 가리지 않게 한다.
        if (docked && edge.includes('e')) return null;
        if (atTop && edge === 'n') return null;
        return (
          <div
            key={edge} data-handle={edge} onPointerDown={beginResize(edge)}
            style={{ position: 'absolute', zIndex: 5, touchAction: 'none', ...pos }}
          />
        );
      })}
    </div>
  );
}

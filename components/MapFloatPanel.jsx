'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Minus, Maximize2, RotateCcw, GripHorizontal } from 'lucide-react';
import { PALETTE } from '../lib/ui-helpers';

// v221: 지도 위에 뜨는 작은 창(레이어 등). 제목줄을 끌어 옮기고, 접고, 닫을 수 있다.
// - 위치는 지도 영역 기준이고 항상 지도 안에 머문다(제목줄이 늘 보이게). 본문은 지도 높이에 맞춰 스크롤돼서 잘리지 않는다.
// - 옮긴 위치는 브라우저에 기억한다(localStorage `apt-dashboard-float:<id>`). ↺로 원래 자리.
const HEAD_H = 36;

export function clampPos(p, box, w, h = HEAD_H) {
  if (!p) return p;
  if (!box || !(box.w > 0) || !(box.h > 0)) return p;
  return {
    x: Math.round(Math.max(4, Math.min(p.x, box.w - w - 4))),
    y: Math.round(Math.max(4, Math.min(p.y, box.h - Math.min(h, HEAD_H) - 4))),
  };
}

// 지도 영역(containerRef) 크기를 잰다.
export function useContainerBox(containerRef) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef && containerRef.current;
    if (!el) return undefined;
    const measure = () => setBox((prev) => (prev.w === el.clientWidth && prev.h === el.clientHeight ? prev : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);
  return box;
}

// 끌어서 옮긴 위치({x,y} | null=기본 자리)와 끌기 시작 함수. 저장 effect의 첫 실행은 건너뛴다(빈 값이 저장값을 덮지 않게).
export function useDragPos(storageKey, box) {
  const [pos, setPos] = useState(null);
  const boxRef = useRef(box);
  boxRef.current = box;
  useEffect(() => {
    try {
      const s = JSON.parse(window.localStorage.getItem(storageKey) || 'null');
      if (s && Number.isFinite(s.x) && Number.isFinite(s.y)) setPos({ x: s.x, y: s.y });
    } catch (e) { /* 저장소를 못 쓰면 기본 자리 */ }
  }, [storageKey]);
  const skipFirstSave = useRef(true);
  useEffect(() => {
    if (skipFirstSave.current) { skipFirstSave.current = false; return; }
    try {
      if (pos) window.localStorage.setItem(storageKey, JSON.stringify(pos));
      else window.localStorage.removeItem(storageKey);
    } catch (e) { /* 무시 */ }
  }, [storageKey, pos]);
  const startDrag = (e, cur, w, h) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev) => setPos(clampPos({ x: cur.x + ev.clientX - sx, y: cur.y + ev.clientY - sy }, boxRef.current, w, h));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      try { document.body.style.userSelect = ''; } catch (err) { /* noop */ }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    try { document.body.style.userSelect = 'none'; } catch (err) { /* noop */ }
  };
  return { pos, setPos, startDrag };
}

const iconBtn = {
  width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', color: PALETTE.textMuted, padding: 0,
};

export default function MapFloatPanel({
  id, title, containerRef, defaultPos, width = 240, onClose, children,
}) {
  const box = useContainerBox(containerRef);
  const { pos, setPos, startDrag } = useDragPos(`apt-dashboard-float:${id}`, box);
  const [min, setMin] = useState(false);
  const w = box.w > 0 ? Math.min(width, Math.max(160, box.w - 8)) : width;
  const p0 = clampPos(pos || defaultPos, box, w);
  // 펼친 상태면 본문이 최소 60px은 지도 안에 들어오게 창을 위로 올린다(아래로 끌어 놓아도 창이 지도 밖으로 잘리지 않게).
  const p = !min && box.h > 0 ? { x: p0.x, y: Math.max(4, Math.min(p0.y, box.h - HEAD_H - 70)) } : p0;
  const bodyMaxH = box.h > 0 ? Math.max(60, box.h - p.y - HEAD_H - 10) : undefined;
  return (
    <div
      data-float={id}
      style={{
        position: 'absolute', left: p.x, top: p.y, width: w, zIndex: 26, display: 'flex', flexDirection: 'column',
        background: 'rgba(255,255,255,0.98)', border: `1px solid ${PALETTE.border}`, borderRadius: 12,
        boxShadow: '0 8px 24px rgba(0,0,0,0.14)', backdropFilter: 'blur(10px)', overflow: 'hidden',
      }}
    >
      <div
        onPointerDown={(e) => { if (!(e.target.closest && e.target.closest('[data-nodrag]'))) startDrag(e, p, w); }}
        onDoubleClick={(e) => { if (!(e.target.closest && e.target.closest('[data-nodrag]'))) setMin((v) => !v); }}
        title="끌어서 옮길 수 있어요 (두 번 누르면 접기)"
        style={{
          height: HEAD_H, flex: 'none', display: 'flex', alignItems: 'center', gap: 4, padding: '0 4px 0 8px',
          background: PALETTE.panelAlt, borderBottom: min ? 'none' : `1px solid ${PALETTE.border}`,
          cursor: 'grab', userSelect: 'none', touchAction: 'none',
        }}
      >
        <GripHorizontal size={14} color={PALETTE.textMuted} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {pos && (
          <button type="button" data-nodrag style={iconBtn} onClick={() => setPos(null)} title="원래 자리로" aria-label="원래 자리로">
            <RotateCcw size={14} />
          </button>
        )}
        <button type="button" data-nodrag style={iconBtn} onClick={() => setMin((v) => !v)} title={min ? '펼치기' : '접기'} aria-label={min ? '펼치기' : '접기'}>
          {min ? <Maximize2 size={14} /> : <Minus size={15} />}
        </button>
        {onClose && (
          <button type="button" data-nodrag style={iconBtn} onClick={onClose} title="닫기" aria-label="닫기">
            <X size={15} />
          </button>
        )}
      </div>
      {!min && (
        <div style={{ padding: 10, maxHeight: bodyMaxH, overflowY: 'auto', overscrollBehavior: 'contain' }}>
          {children}
        </div>
      )}
    </div>
  );
}

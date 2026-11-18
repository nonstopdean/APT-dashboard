'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { localComplexMatches } from '../lib/complex-search';

// v229: 단지 이름 자동완성. 입력칸(anchorRef) 바로 아래에 목록을 띄운다 — 불러온 지역의 단지(바로 이동)와
// 전국 단지(카카오 검색, /api/complex-search). 목록은 body에 붙여서(portal) 가로 스크롤 줄이나 흐림 효과 상자에 잘리지 않게 한다.
// 입력칸에서 포커스가 빠지면 닫히므로, 목록을 누를 때는 mousedown 기본 동작을 막아 포커스를 유지한다.
const remoteCache = new Map(); // 검색어 → 결과(이번 접속 동안)

const fmtPrice = (v) => (Number.isFinite(v) ? (v >= 10000 ? `${(v / 10000).toFixed(1).replace(/\.0$/, '')}억` : `${Math.round(v).toLocaleString()}만`) : '');

export default function ComplexSuggest({
  anchorRef, query, visible, local = [], onPickLocal, onPickRemote, onResults, hint, dark = false,
}) {
  const [remote, setRemote] = useState({ q: '', rows: [], loading: false, error: '' });
  const [box, setBox] = useState(null);
  const q = String(query || '').trim();
  const qOk = q.replace(/\s+/g, '').length >= 2;
  const onResultsRef = useRef(onResults);
  useEffect(() => { onResultsRef.current = onResults; }, [onResults]);

  // 입력이 멈추고 0.3초 뒤에 전국 검색. 같은 검색어는 다시 묻지 않는다.
  useEffect(() => {
    if (!visible || !qOk) return undefined;
    if (remoteCache.has(q)) {
      const rows = remoteCache.get(q);
      setRemote({ q, rows, loading: false, error: '' });
      onResultsRef.current?.(q, rows);
      return undefined;
    }
    let cancelled = false;
    setRemote((r) => ({ ...r, loading: true, error: '' }));
    const t = setTimeout(() => {
      fetch(`/api/complex-search?q=${encodeURIComponent(q)}`)
        .then((res) => res.json())
        .then((json) => {
          if (cancelled) return;
          const rows = Array.isArray(json?.results) ? json.results : [];
          if (!json?.error) remoteCache.set(q, rows);
          setRemote({ q, rows, loading: false, error: json?.error || '' });
          onResultsRef.current?.(q, rows);
        })
        .catch(() => { if (!cancelled) setRemote({ q, rows: [], loading: false, error: '단지 검색에 실패했어요.' }); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, qOk, visible]);

  // 입력칸 위치를 따라간다(화면 크기 변경·스크롤).
  useEffect(() => {
    if (!visible || !anchorRef?.current) { setBox(null); return undefined; }
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const width = Math.min(Math.max(r.width, 300), vw - 16);
      const left = Math.max(8, Math.min(r.left, vw - width - 8));
      setBox({ left, top: r.bottom + 6, width, maxHeight: Math.max(160, window.innerHeight - r.bottom - 20) });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [visible, anchorRef, q]);

  if (!visible || !qOk || !box || typeof document === 'undefined') return null;
  const localRows = localComplexMatches(local, q, 5);
  const localIds = new Set(localRows.map((c) => `${c.regionCode}|${c.dong}`));
  // 불러온 지역에 이미 나온 단지와 같은 곳(같은 지역·동·비슷한 이름)은 전국 목록에서 뺀다.
  const remoteRows = (remote.q === q ? remote.rows : []).filter((r) => !localRows.some((c) => localIds.has(`${r.regionCode}|${r.dong}`)
    && (c.apt.replace(/\s+/g, '').includes(r.name.replace(/\s+/g, '')) || r.name.replace(/\s+/g, '').includes(c.apt.replace(/\s+/g, '')))));
  const loading = remote.loading || remote.q !== q;

  const sectionTitle = { padding: '7px 12px 4px', fontSize: 10.5, color: '#9C9B96', fontWeight: 700 };
  const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', borderTop: '1px solid #f3f3f1' };
  const hover = (on) => (e) => { e.currentTarget.style.background = on ? '#f7f5f2' : ''; };

  return createPortal(
    <div
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: 'fixed', left: box.left, top: box.top, width: box.width, maxHeight: Math.min(420, box.maxHeight), overflowY: 'auto',
        background: '#fff', color: '#2b2722', borderRadius: 10, border: '1px solid rgba(40,35,30,0.14)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.2)', zIndex: 400, fontSize: 12.5,
      }}
      data-dark={dark ? '1' : undefined}
    >
      {localRows.length > 0 && (
        <>
          <div style={sectionTitle}>불러온 지역</div>
          {localRows.map((c) => (
            <div key={`l${c.key}`} style={rowStyle} onClick={() => onPickLocal?.(c)} onMouseEnter={hover(true)} onMouseLeave={hover(false)}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.leader ? '👑 ' : ''}{c.apt}</b>
                <span style={{ fontSize: 11, color: '#9C9B96' }}>{c.regionName} {c.dong}</span>
              </span>
              {c.latestPrice != null && <span style={{ color: '#1D4ED8', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtPrice(c.latestPrice)}</span>}
            </div>
          ))}
        </>
      )}
      <div style={sectionTitle}>전국 단지{loading ? ' · 찾는 중…' : ''}</div>
      {!loading && remote.error && <div style={{ padding: '6px 12px 10px', fontSize: 11.5, color: '#B23A2E' }}>{remote.error}</div>}
      {!loading && !remote.error && remoteRows.length === 0 && (
        <div style={{ padding: '6px 12px 10px', fontSize: 11.5, color: '#9C9B96' }}>
          {localRows.length ? '다른 지역에서 더 찾은 단지가 없어요.' : '이름이 맞는 아파트 단지를 못 찾았어요.'}
        </div>
      )}
      {remoteRows.map((r) => (
        <div key={`r${r.regionCode}|${r.dong}|${r.jibun}|${r.name}`} style={rowStyle} onClick={() => onPickRemote?.(r)} onMouseEnter={hover(true)} onMouseLeave={hover(false)}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <b style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</b>
            <span style={{ fontSize: 11, color: '#9C9B96' }}>{r.address}</span>
          </span>
        </div>
      ))}
      {hint && <div style={{ padding: '7px 12px', fontSize: 10.5, color: '#9C9B96', borderTop: '1px solid #eee', background: '#faf9f7' }}>{hint}</div>}
    </div>,
    document.body,
  );
}

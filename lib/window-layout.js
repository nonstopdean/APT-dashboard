// 떠 있는 창(단지 상세)의 위치·크기 계산. 화면 요소 없이 숫자만 다루는 순수 함수라서 따로 테스트한다.
// 규칙: 창은 항상 화면 안(왼쪽·오른쪽·아래)과 상단 헤더 아래에만 있게 해서, 어떤 조작으로도 잘리지 않는다.

export const MIN_W = 320;
export const MIN_H = 240;
export const BAR_H = 44; // 제목줄 높이 = 최소화했을 때 창 높이
export const DEFAULT_W = 420;
export const NARROW_MAX = 768; // 이 폭 이하(모바일)에서는 이동·크기조절 없이 하단 시트로 보여준다

const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

// 창이 실제로 차지하는 높이(최소화하면 제목줄만).
export const effectiveHeight = (l) => (l.minimized ? BAR_H : l.h);

// 화면(vw×vh)과 헤더 높이(top) 안으로 밀어 넣는다.
export function clampLayout(l, vw, vh, top) {
  const maxW = Math.max(MIN_W, vw);
  const maxH = Math.max(MIN_H, vh - top);
  const w = Math.min(Math.max(num(l.w, DEFAULT_W), Math.min(MIN_W, maxW)), maxW);
  const h = Math.min(Math.max(num(l.h, maxH), Math.min(MIN_H, maxH)), maxH);
  const eh = l.minimized ? BAR_H : h;
  const x = Math.min(Math.max(num(l.x, vw - w), 0), Math.max(0, vw - w));
  const y = Math.min(Math.max(num(l.y, top), top), Math.max(top, vh - eh));
  return { x, y, w, h, minimized: !!l.minimized };
}

// 기본 위치: 오른쪽에 붙고 헤더 아래부터 화면 끝까지.
export function dockedLayout(w, vw, vh, top, minimized = false) {
  return clampLayout({ x: vw, y: top, w, h: vh - top, minimized }, vw, vh, top);
}

export const isDockedRight = (l, vw) => Math.abs(l.x + l.w - vw) <= 4;
export const isFullHeight = (l, vh, top) => l.h >= vh - top - 2;

// 가장자리/모서리 핸들을 dx,dy만큼 끌었을 때의 새 사각형. 반대편 가장자리는 고정한다.
// edge: 'n' 's' 'e' 'w' 'ne' 'nw' 'se' 'sw'
export function resizeRect(start, edge, dx, dy, vw, vh, top) {
  let { x, y, w, h } = start;
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  if (edge.includes('e')) w = start.w + dx;
  if (edge.includes('s')) h = start.h + dy;
  if (edge.includes('w')) w = start.w - dx;
  if (edge.includes('n')) h = start.h - dy;
  // 화면 안에서 가능한 최대 크기(고정된 반대편 가장자리 기준)
  const maxW = edge.includes('w') ? right : vw - start.x;
  const maxH = edge.includes('n') ? bottom - top : vh - start.y;
  w = Math.min(Math.max(w, Math.min(MIN_W, maxW)), maxW);
  h = Math.min(Math.max(h, Math.min(MIN_H, maxH)), maxH);
  if (edge.includes('w')) x = right - w;
  if (edge.includes('n')) y = bottom - h;
  return { x, y, w, h };
}

// 끌어서 오른쪽 위 모서리 근처에 놓으면 다시 기본 위치(도킹)로 붙인다.
export function snapIfNearDock(l, vw, vh, top, tol = 16) {
  if (l.minimized) return l;
  if (Math.abs(l.x + l.w - vw) <= tol && Math.abs(l.y - top) <= tol) return dockedLayout(l.w, vw, vh, top, l.minimized);
  return l;
}

// 지도 툴바가 비켜줄 오른쪽 여백(px). 오른쪽에 붙어 있을 때만 창 폭만큼, 아니면 0.
export function rightInset(l, vw, narrow) {
  if (narrow) return 0;
  return isDockedRight(l, vw) ? Math.round(l.w) : 0;
}

// 화면 크기가 바뀔 때: 오른쪽에 붙어 있었으면 계속 붙이고, 높이를 가득 쓰고 있었으면 가득 쓴다.
export function onViewportResize(l, oldVw, oldVh, vw, vh, top) {
  const wasRight = isDockedRight(l, oldVw);
  const wasFull = isFullHeight(l, oldVh, top);
  const next = { ...l };
  if (wasRight) next.x = vw - l.w;
  if (wasFull) next.h = vh - top;
  return clampLayout(next, vw, vh, top);
}

import { regionLabel } from './regions';
import { roneRegionLabel } from './rone-regions';

// page.jsx와 components/ComplexDetail.jsx가 공통으로 쓰는 순수 상수·함수들을 모아둔 곳.
// 두 파일이 서로를 바로 import하면 순환참조가 생기므로, 공유할 것들은 여기로 빼서
// 둘 다 이 파일만 바라보게 한다.

export const LINE_COLORS = ['#C79A46', '#5B8AA6', '#B85C4A', '#6B8F5E', '#8B7EC8', '#C4763A'];
export const SIDO_SHORT_NAMES = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
export const LISTING_STATUSES = ['관심', '현장확인', '협의중', '보류', '제외'];
export const VISIT_CHECK_ITEMS = ['주차', '소음', '일조', '관리상태', '동간거리', '주변환경'];
export const VISIT_RATINGS = ['좋음', '보통', '나쁨'];

export const PALETTE = {
  bg: '#F5F5F3',
  panel: '#FFFFFF',
  panelAlt: '#F1F1EF',
  border: '#E6E5E1',
  borderStrong: '#D2D0CA',
  textPrimary: '#18181B',
  textSecondary: '#6B6B67',
  textMuted: '#9C9B96',
  up: '#EF4444',
  down: '#3B6FE0',
  accent: '#EF4444',
};

export function fmtWon(manwon) {
  if (manwon == null || Number.isNaN(manwon)) return '-';
  const eok = manwon / 10000;
  if (Math.abs(eok) >= 1) return `${eok.toFixed(2)}억`;
  return `${Math.round(manwon).toLocaleString()}만`;
}

export function monthLabel(ym) {
  return `${ym.slice(0, 4)}.${ym.slice(4, 6)}`;
}

export function fmtPct(v) {
  if (v == null || Number.isNaN(v)) return '-';
  const s = v > 0 ? '+' : '';
  return `${s}${v.toFixed(1)}%`;
}

// 전용면적을 ㎡와 평 두 단위로 같이 보여준다 (소수점 없이).
export function fmtArea(area) {
  if (area == null || Number.isNaN(area)) return '-';
  return `${Math.round(area)}㎡(${Math.round(area / 3.3058)}평)`;
}

export function fmtManwon(manwon) {
  if (manwon == null || Number.isNaN(manwon)) return '-';
  return `${Math.round(manwon).toLocaleString()}만원`;
}

// 취득세 대략 계산 (1주택자 기준 표준세율 근사치 + 지방교육세 등). 다주택자 중과, 생애최초 감면 등은
// 반영하지 않은 단순 참고용 수치이며, 실제 세액은 취득 시점 법령과 세무사 확인이 필요하다.
export function calcAcquisitionTax(amountManwon) {
  if (!amountManwon) return null;
  const eok = amountManwon / 10000;
  let rate;
  if (eok <= 6) rate = 1.0;
  else if (eok <= 9) rate = (eok * 2) / 3 - 3;
  else rate = 3.0;
  const acquisitionTax = amountManwon * (rate / 100);
  const localEduTax = acquisitionTax * 0.1;
  const ruralTax = amountManwon * 0.002; // 전용 85㎡ 초과 가정 근사치
  return { rate, acquisitionTax, localEduTax, ruralTax, total: acquisitionTax + localEduTax + ruralTax };
}

// 대출 가능액 대략 추정 (LTV만 반영한 단순 근사치, DSR/DTI·소득·기존대출 등은 미반영).
export function calcLoanEstimate(amountManwon, isRegulated) {
  if (!amountManwon) return null;
  const ltv = isRegulated ? 0.4 : 0.7;
  return { ltv, maxLoan: amountManwon * ltv };
}

export function slopeClass(deg) {
  if (deg == null) return '';
  if (deg < 5) return '평탄';
  if (deg < 15) return '완경사';
  if (deg < 25) return '중경사';
  return '급경사';
}

export function labelFor(code) {
  return roneRegionLabel(code, regionLabel(code));
}

// 화면 카드에 표시하는 빌드 번호 — 배포가 실제로 반영됐는지 눈으로 확인하기 위한 값.
export const APP_BUILD = 'v175';

// 상단 고정 헤더 높이(px). 떠 있는 창이 헤더 아래에 깔리지 않도록 같은 값을 쓴다.
export const HEADER_HEIGHT = 58;

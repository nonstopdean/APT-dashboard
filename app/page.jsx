'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import * as topojson from 'topojson-client';
import { geoMercator, geoPath } from 'd3-geo';
import KakaoChoropleth from '../components/KakaoChoropleth';
import NaverChoropleth from '../components/NaverChoropleth';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { RefreshCw, TrendingUp, TrendingDown, AlertCircle, X, Building2, ChevronLeft, ChevronRight } from 'lucide-react';
import { REGION_GROUPS, regionLabel, SIDO_AGGREGATES, isSidoAggregate, expandRegionCode, isRegulatedByCode } from '../lib/regions';
import { fetchDongGeoForSido, normalizeDongName } from '../lib/dong-geo';
import { nearestStation, allStations } from '../lib/subway';
import { SIDO_REGIONS, roneRegionLabel } from '../lib/rone-regions';
import ComplexDetail from '../components/ComplexDetail';
import MapTab from '../components/MapTab';
import CompareTab from '../components/CompareTab';
import SubscriptionsTab from '../components/SubscriptionsTab';
import AnalyticsTab from '../components/AnalyticsTab';
import MarketTab from '../components/MarketTab';
import FavoritesTab from '../components/FavoritesTab';
import {
  LINE_COLORS, PALETTE, fmtPct, fmtArea, fmtManwon, calcAcquisitionTax, calcLoanEstimate, slopeClass, labelFor,
  fmtWon, monthLabel, SIDO_SHORT_NAMES, LISTING_STATUSES, VISIT_CHECK_ITEMS, VISIT_RATINGS,
} from '../lib/ui-helpers';

const RONE_ONLY_EXTRA = SIDO_REGIONS.filter((r) => ['90001', '90002', '90003'].includes(r.code));

const DEFAULT_SELECTED = [];
const SIDO_FULL_TO_SHORT = {
  서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주',
  대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종', 경기도: '경기', 강원특별자치도: '강원',
  충청북도: '충북', 충청남도: '충남', 전북특별자치도: '전북', 전라남도: '전남', 경상북도: '경북',
  경상남도: '경남', 제주특별자치도: '제주',
};

const ACCENT_TEXT = '#FFFFFF';

// 국토부 API는 전용면적(㎡)만 제공하고 공급면적은 주지 않아서 (건물마다 비율이 달라 정확한
// 환산이 불가능), 평 단위 전용면적만 정수로 보여준다.
function fmtPyeong(area) {
  if (area == null || Number.isNaN(area)) return '-';
  return `${Math.round(area / 3.3058)}평`;
}

// 억 단위로 안 바꾸고 항상 만원 단위 그대로 보여준다.
// 두 좌표 사이의 실제 거리(미터)를 계산한다 — 주변 단지 비교에 사용.
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 동지(12/21) 하루 동안 각 방향(향) 창면이 직사광을 받는 시간을 천문 계산으로 구한다.
// 대기굴절·지형 음영은 무시한 근사치라서 ±10분 내외 오차가 있고, 건물 배치는 반영되지 않는다.
function computeWinterSun(latDeg, lngDeg) {
  const rad = Math.PI / 180;
  const lat = latDeg * rad;
  const decl = -23.44 * rad;
  const H0 = Math.acos(Math.max(-1, Math.min(1, -Math.tan(lat) * Math.tan(decl)))) / rad; // 일출/일몰 시각각
  const noon = 12 + (135 - lngDeg) * 4 / 60; // KST 기준 태양정중시각 (한국 표준자오선 135°E)
  const fmtHm = (h) => {
    let m = Math.round(h * 60);
    const hh = Math.floor(m / 60);
    m %= 60;
    return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };
  const noonAlt = 90 - Math.abs(latDeg - decl / rad);
  const facades = [['남향', 180], ['남동향', 135], ['동향', 90], ['남서향', 225], ['서향', 270]].map(([label, D]) => {
    let cnt = 0;
    const step = 1 / 6; // 10분 간격
    for (let t = noon - H0 / 15; t <= noon + H0 / 15; t += step) {
      const H = (t - noon) * 15 * rad;
      const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
      if (sinAlt <= 0) continue;
      const A = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat));
      const az = (180 + A / rad + 360) % 360; // 북쪽 기준 시계방향 방위각
      if (Math.abs(az - D) < 90) cnt += 1;
    }
    return { label, hours: Math.round(cnt * step * 10) / 10 };
  });
  return {
    sunrise: fmtHm(noon - H0 / 15),
    sunset: fmtHm(noon + H0 / 15),
    noonAlt: Math.round(noonAlt),
    facades,
  };
}

// 취득세 대략 계산 (1주택자 기준 표준세율 근사치 + 지방교육세 등). 다주택자 중과, 생애최초 감면 등은
// 반영하지 않은 단순 참고용 수치이며, 실제 세액은 취득 시점 법령과 세무사 확인이 필요하다.
// 대출 가능액 대략 추정 (LTV만 반영한 단순 근사치, DSR/DTI·소득·기존대출 등은 미반영).
// z-score를 저평가/고평가 라벨로 바꾼다. 공식 시세 평가가 아니라, 지금 조회된 데이터
// 안에서 비슷한 지역·평형 대비 상대적으로 어디쯤인지 보여주는 참고용 점수임을 항상 명시한다.
// 표준정규분포 누적확률(대략치) — z-score를 "비교군 안에서 하위/상위 몇 %인지"로 바꿔서 보여준다.
function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

// z-score를 "저평가/고평가" 같은 투자 판단성 단어 대신, 비교군 안에서의 상대적 위치(백분위)로
// 표현한다 — 공식 시세 평가가 아니라 지금 조회된 데이터 안에서의 통계적 위치일 뿐이라서다.
function valuationLabel(z) {
  if (z == null) return null;
  const pct = Math.round(normalCdf(z) * 100);
  if (z <= -1) return { text: `하위 ${pct}%`, color: '#3B6FE0', bg: 'rgba(59,111,224,0.1)', extreme: z <= -2 };
  if (z >= 1) return { text: `상위 ${100 - pct}%`, color: '#B23A2E', bg: 'rgba(178,58,46,0.1)', extreme: z >= 2 };
  return null;
}

function ZBadge({ z }) {
  const v = valuationLabel(z);
  if (!v) return <span style={{ fontSize: 10.5, color: '#9a9488' }}>-</span>;
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, color: v.color, background: v.bg, borderRadius: 6, padding: '2px 6px', whiteSpace: 'nowrap' }} title={`같은 지역·비슷한 평형 단지들과 비교했을 때 평당가 ${v.text} 위치(z=${z.toFixed(2)}). 저평가/고평가 판단이 아닌 통계적 위치일 뿐이며, 공식 시세평가가 아닙니다.`}>
      {v.text}
    </span>
  );
}

function Sparkline({ points }) {
  if (!points || points.length < 2) return <span style={{ fontSize: 10, color: '#9a9488' }}>-</span>;
  const w = 70; const h = 22;
  const min = Math.min(...points); const max = Math.max(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(h - ((p - min) / range) * h).toFixed(1)}`).join(' ');
  const up = points[points.length - 1] >= points[0];
  return (
    <svg width={w} height={h} aria-label={`최근 ${points.length}개월 평당가 추이`}>
      <path d={path} fill="none" stroke={up ? '#B23A2E' : '#3B6FE0'} strokeWidth="1.5" />
    </svg>
  );
}

// 층 분포를 "저층 n / 중층 n / 고층 n" 형태로 줄여서 보여준다 (단지 비교 표용).
function floorDistLabel(floorDist) {
  if (!floorDist) return '-';
  const parts = [];
  if (floorDist.low) parts.push(`저 ${floorDist.low}`);
  if (floorDist.mid) parts.push(`중 ${floorDist.mid}`);
  if (floorDist.high) parts.push(`고 ${floorDist.high}`);
  return parts.length ? parts.join(' / ') : '-';
}

// KOSTAT 지도 데이터의 시/도 코드(앞 2자리) -> 시/도 이름. 우리 REGION_GROUPS와 이름이 다른
// (개편된) 시/도는 별칭으로 연결한다.
const KOSTAT_SIDO_CODE_TO_NAME = {
  '11': '서울특별시', '21': '부산광역시', '22': '대구광역시', '23': '인천광역시',
  '24': '광주광역시', '25': '대전광역시', '26': '울산광역시', '29': '세종특별자치시',
  '31': '경기도', '32': '강원도', '33': '충청북도', '34': '충청남도',
  '35': '전라북도', '36': '전라남도', '37': '경상북도', '38': '경상남도', '39': '제주특별자치도',
};
const SIDO_NAME_ALIAS = { '강원도': '강원특별자치도', '전라북도': '전북특별자치도' };

function ymNow() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function ymShift(ym, delta) {
  const y = parseInt(ym.slice(0, 4), 10);
  const m = parseInt(ym.slice(4, 6), 10);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: currentYear - 2005 + 1 }, (_, i) => String(2005 + i)).reverse();
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

export default function Page() {
  const [dealType, setDealType] = useState('trade');
  const [unitSizeFilter, setUnitSizeFilter] = useState('all');
  const [buildYearFilter, setBuildYearFilter] = useState('all');
  const [propertyType, setPropertyType] = useState('apt'); // 'apt' | 'offi' (매매/전월세에만 적용)
  const isRent = dealType === 'rent';
  const isRone = dealType === 'rone';
  const isRatio = dealType === 'ratio';
  const isSilv = dealType === 'silv';
  const [panelOpen, setPanelOpen] = useState(true);
  const [viewMode, setViewMode] = useState('normal'); // 'normal' | 'map'
  const [startYm, setStartYm] = useState(ymShift(ymNow(), -5));
  const [endYm, setEndYm] = useState(ymNow());
  const [selected, setSelected] = useState(DEFAULT_SELECTED);
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [rawByRegionMonth, setRawByRegionMonth] = useState({});
  const [months, setMonths] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);

  const [roneSeries, setRoneSeries] = useState({});
  const [roneMonths, setRoneMonths] = useState([]);
  const [roneUnmapped, setRoneUnmapped] = useState([]);

  const [saleRaw, setSaleRaw] = useState({});
  const [jeonseRaw, setJeonseRaw] = useState({});

  const setDealTypeSafe = (next) => {
    if (next !== 'rone') {
      setSelected((prev) => prev.filter((c) => !RONE_ONLY_EXTRA.some((r) => r.code === c)));
    }
    setDealType(next);
  };

  const [favorites, setFavorites] = useState([]);
  const [favName, setFavName] = useState('');
  const [mapFeatures, setMapFeatures] = useState(null);
  const [mapError, setMapError] = useState('');
  const [selectedApt, setSelectedApt] = useState(null);
  const [calcPriceInput, setCalcPriceInput] = useState('');
  const [nearbyRadius, setNearbyRadius] = useState(1000); // meters
  const [pinnedComplexes, setPinnedComplexes] = useState([]); // [{apt, dong, regionCode}] 최대 5개
  const [userAlerts, setUserAlerts] = useState([]);
  const [scenario, setScenario] = useState({ price: '', cash: '', rate: '4.0', years: '30', listingId: '' });
  const [myListings, setMyListings] = useState([]); // 사용자가 직접 기록한 매물 호가 (localStorage)
  const [listingForm, setListingForm] = useState({ apt: '', dong: '', area: '', floor: '', price: '', memo: '', status: '관심' });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('myListings') || '[]');
      if (Array.isArray(saved)) setMyListings(saved);
    } catch (e) { /* 저장된 값이 손상된 경우 무시 */ }
  }, []);
  const saveListings = (next) => {
    setMyListings(next);
    try { localStorage.setItem('myListings', JSON.stringify(next)); } catch (e) { /* 저장 실패는 조용히 무시 */ }
  };
  const addListing = () => {
    if (!listingForm.apt || !listingForm.price) return;
    const today = new Date().toISOString().slice(0, 10);
    const entry = { ...listingForm, id: `${Date.now()}`, checkedAt: today, history: [{ status: listingForm.status, date: today }] };
    saveListings([entry, ...myListings]);
    setListingForm({ apt: '', dong: '', area: '', floor: '', price: '', memo: '', status: '관심' });
  };
  const removeListing = (id) => saveListings(myListings.filter((l) => l.id !== id));
  const updateListingStatus = (id, status) => {
    const today = new Date().toISOString().slice(0, 10);
    saveListings(myListings.map((l) => (
      l.id === id && l.status !== status
        ? { ...l, status, history: [...(l.history || []), { status, date: today }] }
        : l
    )));
  };

  // 현장답사 체크리스트 — 온라인 통계에 없는 방문 확인 정보를 이 기기에만 저장한다.
  const [myVisits, setMyVisits] = useState([]);
  const [visitForm, setVisitForm] = useState({
    apt: '', dong: '', memo: '', checks: Object.fromEntries(VISIT_CHECK_ITEMS.map((k) => [k, ''])),
  });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('myVisits') || '[]');
      if (Array.isArray(saved)) setMyVisits(saved);
    } catch (e) { /* 저장된 값이 손상된 경우 무시 */ }
  }, []);
  const saveVisits = (next) => {
    setMyVisits(next);
    try { localStorage.setItem('myVisits', JSON.stringify(next)); } catch (e) { /* 저장 실패는 조용히 무시 */ }
  };
  const addVisit = () => {
    if (!visitForm.apt) return;
    const entry = { ...visitForm, id: `${Date.now()}`, visitedAt: new Date().toISOString().slice(0, 10) };
    saveVisits([entry, ...myVisits]);
    setVisitForm({ apt: '', dong: '', memo: '', checks: Object.fromEntries(VISIT_CHECK_ITEMS.map((k) => [k, ''])) });
  };
  const removeVisit = (id) => saveVisits(myVisits.filter((v) => v.id !== id));

  const [alertFormOpen, setAlertFormOpen] = useState(false);
  const [alertTargetPrice, setAlertTargetPrice] = useState('');
  const [alertDirection, setAlertDirection] = useState('below');
  const [alertSaving, setAlertSaving] = useState(false);

  const loadUserAlerts = () => {
    fetch('/api/user-alerts').then((res) => res.json()).then((json) => setUserAlerts(json?.alerts || [])).catch(() => {});
  };

  useEffect(() => { if (viewMode === 'favorites') loadUserAlerts(); }, [viewMode]);

  const submitAlert = async () => {
    const price = parseFloat(alertTargetPrice);
    if (!price || !selectedApt) return;
    setAlertSaving(true);
    try {
      await fetch('/api/user-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apt: selectedApt.apt, dong: selectedApt.dong, regionCode: selectedApt.regionCode,
          regionName: labelFor(selectedApt.regionCode), targetPrice: price * 10000, direction: alertDirection,
        }),
      });
      setAlertFormOpen(false);
      setAlertTargetPrice('');
      loadUserAlerts();
    } catch (e) {
      // 조용히 실패 — 다시 시도하면 된다
    } finally {
      setAlertSaving(false);
    }
  };

  const removeUserAlert = async (id) => {
    await fetch(`/api/user-alerts?id=${id}`, { method: 'DELETE' }).catch(() => {});
    loadUserAlerts();
  };

  const [aptBasicInfo, setAptBasicInfo] = useState(null);
  const [nearbySchools, setNearbySchools] = useState([]);
  const [schoolsLoading, setSchoolsLoading] = useState(false);
  const [subscriptions, setSubscriptions] = useState([]);
  const [subsTabSido, setSubsTabSido] = useState('서울');
  const [subsTabRows, setSubsTabRows] = useState([]);
  const [subsTabLoading, setSubsTabLoading] = useState(false);
  const [subsSubView, setSubsSubView] = useState('list'); // 'list' | 'supply'

  const supplyByMonth = useMemo(() => {
    const byMonth = {};
    subsTabRows.forEach((s) => {
      const ym = (s.moveInMonth || '').trim();
      if (!ym) return;
      const units = parseInt(s.totalUnits, 10);
      if (!Number.isFinite(units)) return;
      byMonth[ym] = (byMonth[ym] || 0) + units;
    });
    return Object.keys(byMonth).sort().map((ym) => ({ ym, 세대수: byMonth[ym] }));
  }, [subsTabRows]);

  const [subscriptionsLoading, setSubscriptionsLoading] = useState(false);

  const currentSidoShort = useMemo(() => {
    if (selected.length === 0) return null;
    const firstCode = selected[0];
    for (const g of REGION_GROUPS) {
      if (g.items.some((it) => it.code === firstCode) || SIDO_AGGREGATES.some((a) => a.code === firstCode && a.sido === g.sido)) {
        return SIDO_FULL_TO_SHORT[g.sido] || g.sido;
      }
    }
    return null;
  }, [selected]);

  useEffect(() => {
    setSubscriptions([]);
    if (!currentSidoShort) return undefined;
    let cancelled = false;
    setSubscriptionsLoading(true);
    const fromDate = ymShift(ymNow(), -12).replace(/(\d{4})(\d{2})/, '$1-$2-01');
    fetch(`/api/subscriptions?sido=${encodeURIComponent(currentSidoShort)}&from=${fromDate}`)
      .then((res) => res.json())
      .then((json) => { if (!cancelled) setSubscriptions(json?.rows || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSubscriptionsLoading(false); });
    return () => { cancelled = true; };
  }, [currentSidoShort]);

  const subsCacheRef = useRef({}); // sido -> rows

  useEffect(() => {
    if (viewMode !== 'subscriptions') return undefined;
    const cached = subsCacheRef.current[subsTabSido];
    if (cached) {
      setSubsTabRows(cached);
      return undefined;
    }
    let cancelled = false;
    setSubsTabLoading(true);
    const fromDate = ymShift(ymNow(), -12).replace(/(\d{4})(\d{2})/, '$1-$2-01');
    fetch(`/api/subscriptions?sido=${encodeURIComponent(subsTabSido)}&from=${fromDate}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const rows = json?.rows || [];
        subsCacheRef.current[subsTabSido] = rows;
        setSubsTabRows(rows);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSubsTabLoading(false); });
    return () => { cancelled = true; };
  }, [viewMode, subsTabSido]);

  const [populationRows, setPopulationRows] = useState([]);
  const [populationLoading, setPopulationLoading] = useState(false);
  const populationCacheRef = useRef({}); // sido -> rows

  useEffect(() => {
    setPopulationRows([]);
    if (!currentSidoShort) return undefined;
    const cached = populationCacheRef.current[currentSidoShort];
    if (cached) {
      setPopulationRows(cached);
      return undefined;
    }
    let cancelled = false;
    setPopulationLoading(true);
    fetch(`/api/population?sido=${encodeURIComponent(currentSidoShort)}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const rows = json?.rows || [];
        populationCacheRef.current[currentSidoShort] = rows;
        setPopulationRows(rows);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setPopulationLoading(false); });
    return () => { cancelled = true; };
  }, [currentSidoShort]);

  const [migrationRows, setMigrationRows] = useState([]);
  const [migrationLoading, setMigrationLoading] = useState(false);
  const migrationCacheRef = useRef({}); // sido -> rows

  useEffect(() => {
    setMigrationRows([]);
    if (!currentSidoShort) return undefined;
    const cached = migrationCacheRef.current[currentSidoShort];
    if (cached) {
      setMigrationRows(cached);
      return undefined;
    }
    let cancelled = false;
    setMigrationLoading(true);
    fetch(`/api/migration?sido=${encodeURIComponent(currentSidoShort)}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const rows = json?.rows || [];
        migrationCacheRef.current[currentSidoShort] = rows;
        setMigrationRows(rows);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setMigrationLoading(false); });
    return () => { cancelled = true; };
  }, [currentSidoShort]);

  const aptListCacheRef = useRef({}); // regionCode -> [{kaptCode, kaptName}]

  useEffect(() => {
    setNearbySchools([]);
    if (!selectedApt?.dong) return undefined;
    let cancelled = false;
    setSchoolsLoading(true);
    fetch(`/api/schools?keyword=${encodeURIComponent(selectedApt.dong)}`)
      .then((res) => res.json())
      .then((json) => { if (!cancelled) setNearbySchools(json?.schools || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSchoolsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedApt]);

  useEffect(() => {
    let cancelled = false;
    setAptBasicInfo(null);
    if (!selectedApt) return undefined;

    async function run() {
      try {
        let list = aptListCacheRef.current[selectedApt.regionCode];
        if (!list) {
          const res = await fetch(`/api/apt-list?codes=${selectedApt.regionCode}`);
          const json = await res.json();
          list = json?.data?.[selectedApt.regionCode] || [];
          aptListCacheRef.current[selectedApt.regionCode] = list;
        }
        if (cancelled) return;
        const match = list.find((it) => it.kaptName === selectedApt.apt)
          || list.find((it) => it.kaptName?.replace(/\s/g, '') === selectedApt.apt.replace(/\s/g, ''));

        if (match) {
          const infoRes = await fetch(`/api/apt-basic?kaptCode=${match.kaptCode}`);
          const infoJson = await infoRes.json();
          if (!cancelled && infoJson?.info) {
            setAptBasicInfo(infoJson.info);
            return;
          }
        }

        // 국토부 기본정보로 못 찾았으면, 한국부동산원 단지 식별정보를 주소로 보조 검색해본다.
        const addrQuery = `${labelFor(selectedApt.regionCode)} ${selectedApt.dong}`;
        const idRes = await fetch(`/api/apt-identity?q=${encodeURIComponent(addrQuery)}`);
        const idJson = await idRes.json();
        const rows = idJson?.rows || [];
        const idMatch = rows.find((r) => [r.nameKb, r.nameBldg, r.nameRoad].some(
          (n) => n && n.replace(/\s/g, '').includes(selectedApt.apt.replace(/\s/g, '')),
        ));
        if (!cancelled && idMatch) {
          setAptBasicInfo({
            households: idMatch.households,
            dongCount: idMatch.dongCount,
            useDate: idMatch.useDate,
            builder: null,
          });
        }
      } catch (e) {
        // 조용히 실패 — 모달의 나머지 정보는 그대로 보여준다
      }
    }
    run();
    return () => { cancelled = true; };
  }, [selectedApt]);


  useEffect(() => {
    if (viewMode !== 'map' || mapFeatures) return undefined;
    let cancelled = false;
    fetch('https://cdn.jsdelivr.net/gh/southkorea/southkorea-maps@master/kostat/2018/json/skorea-municipalities-2018-topo-simple.json')
      .then((r) => r.json())
      .then((topology) => {
        if (cancelled) return;
        const key = Object.keys(topology.objects)[0];
        const geo = topojson.feature(topology, topology.objects[key]);

        // 이름 -> 코드 조회를 시/도별로 나눠서, 같은 이름의 구(중구/서구/남구 등)가 다른
        // 도시에 있어도 헷갈리지 않게 한다.
        const matched = geo.features.map((f) => {
          const featureName = (f.properties.name || '').trim();
          const kostatCode = f.properties.code || '';
          const rawSidoName = KOSTAT_SIDO_CODE_TO_NAME[kostatCode.slice(0, 2)];
          const sidoName = SIDO_NAME_ALIAS[rawSidoName] || rawSidoName;
          const group = sidoName ? REGION_GROUPS.find((g) => g.sido === sidoName) : null;
          const codes = [];
          if (group) {
            const exact = group.items.find((it) => it.name.trim() === featureName);
            if (exact) {
              codes.push(exact.code);
            } else {
              // 일부 구 지도 데이터는 상위 시 이름 없이 구 이름만 붙어 있다
              // (예: "성남시 분당구"가 아니라 "분당구"). 그런 경우를 대비한 보조 매칭.
              const suffixMatch = group.items.find((it) => it.name.trim().endsWith(` ${featureName}`));
              if (suffixMatch) codes.push(suffixMatch.code);
            }
            // 이 지도 데이터는 2018년 기준이라, 그 이후 구로 나뉜 도시(예: 화성시 동탄구)는
            // 지도엔 통합된 폴리곤 하나만 있다. 그런 하위 지역 코드도 같이 묶어둔다.
            group.items
              .filter((it) => it.name.trim().startsWith(`${featureName} `))
              .forEach((it) => codes.push(it.code));
          }
          return { feature: f, name: featureName, codes };
        });
        setMapFeatures(matched);
      })
      .catch(() => { if (!cancelled) setMapError('지도 데이터를 불러오지 못했습니다.'); });
    return () => { cancelled = true; };
  }, [viewMode, mapFeatures]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('apt-dashboard-favorites');
      if (raw) setFavorites(JSON.parse(raw));
    } catch (e) {
      // 저장된 값이 없거나 읽기 실패 시 무시
    }
  }, []);

  const persistFavorites = (next) => {
    setFavorites(next);
    try {
      window.localStorage.setItem('apt-dashboard-favorites', JSON.stringify(next));
    } catch (e) {
      // 저장 실패는 조용히 무시 (예: 저장공간 초과)
    }
  };

  const saveFavorite = () => {
    const name = favName.trim();
    if (!name) return;
    const next = [...favorites.filter((f) => f.name !== name), {
      name, dealType, startYm, endYm, selected: [...selected],
    }];
    persistFavorites(next);
    setFavName('');
  };

  const applyFavorite = (fav) => {
    setDealTypeSafe(fav.dealType);
    if (fav.startYm && fav.endYm) {
      setStartYm(fav.startYm);
      setEndYm(fav.endYm);
    }
    setSelected(fav.selected);
  };

  const removeFavorite = (name) => {
    persistFavorites(favorites.filter((f) => f.name !== name));
  };

  const addRegion = (code) => {
    if (!code) return;
    setSelected((prev) => (prev.includes(code) ? prev : [...prev, code]));
  };
  const removeRegion = (code) => {
    setSelected((prev) => prev.filter((c) => c !== code));
  };
  const [comparePickerValue, setComparePickerValue] = useState('');
  const addRegionAndFetch = (code) => {
    if (!code) return;
    setComparePickerValue('');
    if (codeToLatLng[code]) setFocusLatLng(codeToLatLng[code]);
    if (selected.includes(code)) return;
    const next = [...selected, code];
    setSelected(next);
    handleFetch(next);
  };

  const fetchCacheRef = useRef({});

  const handleFetch = async (codesOverride) => {
    const codesToUse = codesOverride || selected;
    setErrorMsg('');
    if (codesToUse.length === 0) {
      setErrorMsg('지역을 하나 이상 선택해주세요.');
      return;
    }
    if (startYm > endYm) {
      setErrorMsg('시작월이 종료월보다 이후입니다.');
      return;
    }

    const cacheKey = `${dealType}|${propertyType}|${[...codesToUse].sort().join(',')}|${startYm}|${endYm}`;
    const cached = fetchCacheRef.current[cacheKey];
    if (cached) {
      // 같은 조건을 이미 조회한 적 있으면, 네트워크 요청 없이 그 결과를 그대로 다시 쓴다
      // (재조회 버튼을 눌러도 즉시 반응하도록).
      cached.apply();
      setFetchedAt(new Date(cached.fetchedAt));
      setStatus('done');
      return;
    }

    setStatus('loading');
    try {
      if (dealType === 'rone') {
        const res = await fetch(`/api/rone?codes=${codesToUse.join(',')}&start=${startYm}&end=${endYm}`);
        const json = await res.json();
        if (!res.ok) {
          setErrorMsg(json.error || `요청 실패 (HTTP ${res.status})`);
          setStatus('error');
          return;
        }
        setRoneSeries(json.data);
        setRoneMonths(json.months);
        setRoneUnmapped(json.unmapped || []);
        setFetchedAt(new Date(json.fetchedAt));
        if (json.error) setErrorMsg(`일부 항목에서 오류: ${json.error}`);
        setStatus('done');
        fetchCacheRef.current[cacheKey] = {
          fetchedAt: json.fetchedAt,
          apply: () => {
            setRoneSeries(json.data);
            setRoneMonths(json.months);
            setRoneUnmapped(json.unmapped || []);
          },
        };
        return;
      }
      if (dealType === 'ratio') {
        const saleEp = propertyType === 'offi' ? '/api/offi-trades' : '/api/trades';
        const rentEp = propertyType === 'offi' ? '/api/offi-rents' : '/api/rents';
        const [saleRes, rentRes] = await Promise.all([
          fetch(`${saleEp}?codes=${codesToUse.join(',')}&start=${startYm}&end=${endYm}`),
          fetch(`${rentEp}?codes=${codesToUse.join(',')}&start=${startYm}&end=${endYm}`),
        ]);
        const [saleJson, rentJson] = await Promise.all([saleRes.json(), rentRes.json()]);
        if (!saleRes.ok || !rentRes.ok) {
          setErrorMsg(saleJson.error || rentJson.error || '요청 실패');
          setStatus('error');
          return;
        }
        setSaleRaw(saleJson.data);
        setJeonseRaw(rentJson.data);
        setMonths(saleJson.months);
        const now = new Date();
        setFetchedAt(now);
        const combinedError = saleJson.error || rentJson.error;
        if (combinedError) setErrorMsg(`일부 항목에서 오류: ${combinedError}`);
        setStatus('done');
        fetchCacheRef.current[cacheKey] = {
          fetchedAt: now.toISOString(),
          apply: () => {
            setSaleRaw(saleJson.data);
            setJeonseRaw(rentJson.data);
            setMonths(saleJson.months);
          },
        };
        return;
      }
      const endpoint = dealType === 'silv'
        ? '/api/silv-trades'
        : propertyType === 'offi'
          ? (dealType === 'rent' ? '/api/offi-rents' : '/api/offi-trades')
          : (dealType === 'rent' ? '/api/rents' : '/api/trades');
      const res = await fetch(`${endpoint}?codes=${codesToUse.join(',')}&start=${startYm}&end=${endYm}`);
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || `요청 실패 (HTTP ${res.status})`);
        setStatus('error');
        return;
      }
      setRawByRegionMonth(json.data);
      setMonths(json.months);
      setFetchedAt(new Date(json.fetchedAt));
      if (json.error) setErrorMsg(`일부 항목에서 오류: ${json.error}`);
      setStatus('done');
      fetchCacheRef.current[cacheKey] = {
        fetchedAt: json.fetchedAt,
        apply: () => {
          setRawByRegionMonth(json.data);
          setMonths(json.months);
        },
      };
    } catch (e) {
      setErrorMsg('서버 요청 중 오류가 발생했습니다.');
      setStatus('error');
    }
  };

  // 처음 접속 시 지역이 선택돼 있으면 자동 조회 (버튼을 누르지 않아도 바로 데이터가 보이도록)
  useEffect(() => {
    if (selected.length > 0) handleFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getUnitPrice = (item) => (
    dealType === 'rent' ? (item.isJeonse ? item.depositPerPyeong : null) : item.pricePerPyeong
  );

  const monthlyByRegion = useMemo(() => {
    const out = {};
    selected.forEach((code) => {
      out[code] = months.map((ym) => {
        const rows = rawByRegionMonth[`${code}_${ym}`] || [];
        const valid = rows.map(getUnitPrice).filter((v) => v);
        const avgPyeong = valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
        return { ym, count: rows.length, avgPyeong };
      });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, months, rawByRegionMonth, dealType]);

  const chartData = useMemo(() => {
    return months.map((ym) => {
      const row = { ym: monthLabel(ym) };
      selected.forEach((code) => {
        const m = monthlyByRegion[code]?.find((x) => x.ym === ym);
        row[labelFor(code)] = m?.avgPyeong ? Math.round(m.avgPyeong / 10) / 100 : null;
      });
      return row;
    });
  }, [months, selected, monthlyByRegion]);

  const ranking = useMemo(() => {
    return selected.map((code) => {
      const series = monthlyByRegion[code] || [];
      const withData = series.filter((m) => m.avgPyeong);
      const first = withData[0];
      const last = withData[withData.length - 1];
      const change = first && last && first.avgPyeong
        ? ((last.avgPyeong - first.avgPyeong) / first.avgPyeong) * 100
        : null;
      const totalCount = series.reduce((s, m) => s + m.count, 0);
      return {
        code, name: labelFor(code), latestAvgPyeong: last?.avgPyeong ?? null, change, totalCount,
      };
    }).sort((a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity));
  }, [selected, monthlyByRegion]);

  const kpis = useMemo(() => {
    const totalCount = ranking.reduce((s, r) => s + r.totalCount, 0);
    const withPyeong = ranking.filter((r) => r.latestAvgPyeong);
    const avgPyeongAll = withPyeong.length
      ? withPyeong.reduce((s, r) => s + r.latestAvgPyeong, 0) / withPyeong.length
      : null;
    const rising = ranking.filter((r) => r.change != null).sort((a, b) => b.change - a.change)[0];
    const falling = ranking.filter((r) => r.change != null).sort((a, b) => a.change - b.change)[0];

    let avgMonthlyRent = null;
    if (dealType === 'rent') {
      const wolse = [];
      selected.forEach((code) => months.forEach((ym) => {
        (rawByRegionMonth[`${code}_${ym}`] || []).forEach((r) => {
          if (!r.isJeonse && r.monthlyRent > 0) wolse.push(r.monthlyRent);
        });
      }));
      avgMonthlyRent = wolse.length ? wolse.reduce((s, v) => s + v, 0) / wolse.length : null;
    }
    return { totalCount, avgPyeongAll, rising, falling, avgMonthlyRent };
  }, [ranking, dealType, selected, months, rawByRegionMonth]);

  const allTx = useMemo(() => {
    const all = [];
    selected.forEach((code) => {
      const memberCodes = expandRegionCode(code);
      memberCodes.forEach((mc) => {
        months.forEach((ym) => {
          const rows = rawByRegionMonth[`${mc}_${ym}`] || [];
          rows.forEach((r) => all.push({ ...r, regionCode: mc }));
        });
      });
    });
    all.sort((a, b) => {
      const da = `${a.year}${String(a.month).padStart(2, '0')}${String(a.day).padStart(2, '0')}`;
      const db = `${b.year}${String(b.month).padStart(2, '0')}${String(b.day).padStart(2, '0')}`;
      return db.localeCompare(da);
    });
    const currentYear = new Date().getFullYear();
    return all.filter((t) => {
      if (unitSizeFilter !== 'all') {
        const p = t.pyeong;
        const a = t.area;
        if (unitSizeFilter === 'u20' && !(p < 20)) return false;
        if (unitSizeFilter === '20s' && !(p >= 20 && p < 30)) return false;
        if (unitSizeFilter === '30s' && !(p >= 30 && p < 40)) return false;
        if (unitSizeFilter === '40s' && !(p >= 40 && p < 50)) return false;
        if (unitSizeFilter === '50p' && !(p >= 50)) return false;
        // 정확한 전용면적(㎡) 기준 — 같은 평형끼리 비교할 때는 "30평대"보다 이게 더 정확하다.
        // 실거래가는 84.97㎡처럼 딱 떨어지지 않는 경우가 많아 ±2㎡ 오차를 허용한다.
        if (unitSizeFilter.startsWith('sqm')) {
          if (a == null) return false;
          const target = parseInt(unitSizeFilter.slice(3), 10);
          if (Math.abs(a - target) > 2) return false;
        } else if (p == null) return false;
      }
      if (buildYearFilter !== 'all') {
        if (!t.buildYear) return false;
        const age = currentYear - t.buildYear;
        if (buildYearFilter === '5' && !(age <= 5)) return false;
        if (buildYearFilter === '10' && !(age <= 10)) return false;
        if (buildYearFilter === '15' && !(age <= 15)) return false;
        if (buildYearFilter === '20' && !(age <= 20)) return false;
        if (buildYearFilter === '20p' && !(age > 20)) return false;
      }
      return true;
    });
  }, [selected, months, rawByRegionMonth, unitSizeFilter, buildYearFilter]);

  // 아실/호갱노노처럼 가격대(매매금액·보증금, 억 단위)로 거래 내역을 좁혀볼 수 있는 필터.
  const [priceRange, setPriceRange] = useState({ min: '', max: '' });

  const [dongFilter, setDongFilter] = useState('all');
  const dongFilterOptions = useMemo(() => {
    const set = new Set();
    allTx.forEach((t) => { if (t.dong) set.add(t.dong); });
    return [...set].sort();
  }, [allTx]);

  const allTxFiltered = useMemo(() => {
    const min = priceRange.min === '' ? null : parseFloat(priceRange.min);
    const max = priceRange.max === '' ? null : parseFloat(priceRange.max);
    const hasPriceFilter = priceRange.min !== '' || priceRange.max !== '';
    if (!hasPriceFilter && dongFilter === 'all') return allTx;
    return allTx.filter((t) => {
      if (dongFilter !== 'all' && t.dong !== dongFilter) return false;
      if (!hasPriceFilter) return true;
      const v = isRent ? t.deposit : t.amount;
      if (v == null) return false;
      const eok = v / 10000;
      if (min != null && Number.isFinite(min) && eok < min) return false;
      if (max != null && Number.isFinite(max) && eok > max) return false;
      return true;
    });
  }, [allTx, priceRange, isRent, dongFilter]);

  const recentTx = useMemo(() => allTxFiltered.slice(0, 30), [allTxFiltered]);

  const [aptHistory, setAptHistory] = useState([]);
  const [aptHistoryLoading, setAptHistoryLoading] = useState(false);
  const [historyAreaFilter, setHistoryAreaFilter] = useState('all');
  const [historyListLimit, setHistoryListLimit] = useState(30);
  const [trendViewMode, setTrendViewMode] = useState('single'); // 'single' | 'compare'
  const [aptHistoryFullRange, setAptHistoryFullRange] = useState(false);

  useEffect(() => {
    setAptHistory([]);
    setCalcPriceInput('');
    setTradeUpCurrentPrice('');
    setTradeUpLoanBalance('');
    setTradeUpTargetPrice('');
    setAptHistoryFullRange(false);
    if (!selectedApt) return undefined;
    let cancelled = false;
    setAptHistoryLoading(true);
    const endYmH = ymNow();
    // 처음엔 최근 3년치만 가볍게 불러온다 — 20년 전체를 한 번에 부르면 이 구 전체 거래를
    // 20년치 다 받아온 다음 이 단지만 걸러내는 구조라 느려진다. 더 오래된 기록은
    // "더 오래된 기록 불러오기" 버튼을 눌렀을 때만 추가로 받아온다.
    const startYmH = ymShift(endYmH, -35);
    const endpointH = isSilv
      ? '/api/silv-trades'
      : propertyType === 'offi'
        ? (isRent ? '/api/offi-rents' : '/api/offi-trades')
        : (isRent ? '/api/rents' : '/api/trades');
    fetch(`${endpointH}?codes=${selectedApt.regionCode}&start=${startYmH}&end=${endYmH}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const months2 = json?.months || [];
        const rows = [];
        months2.forEach((ym) => {
          (json?.data?.[`${selectedApt.regionCode}_${ym}`] || []).forEach((r) => {
            rows.push({ ...r, regionCode: selectedApt.regionCode });
          });
        });
        const filtered = rows.filter((t) => t.apt === selectedApt.apt && t.dong === selectedApt.dong);
        filtered.sort((a, b) => {
          const da = `${a.year}${String(a.month).padStart(2, '0')}${String(a.day).padStart(2, '0')}`;
          const db = `${b.year}${String(b.month).padStart(2, '0')}${String(b.day).padStart(2, '0')}`;
          return db.localeCompare(da);
        });
        setAptHistory(filtered);
        setHistoryAreaFilter('all');
        setHistoryListLimit(30);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setAptHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [selectedApt, isSilv, propertyType, isRent]);

  // "더 오래된 기록 불러오기"를 눌렀을 때만 20년 전체를 추가로 받아온다.
  const loadFullAptHistory = () => {
    if (!selectedApt || aptHistoryLoading) return;
    setAptHistoryLoading(true);
    const endYmH = ymNow();
    const startYmH = ymShift(endYmH, -239); // 국토부 실거래가 공개 시작(2006년) 즈음까지
    const endpointH = isSilv
      ? '/api/silv-trades'
      : propertyType === 'offi'
        ? (isRent ? '/api/offi-rents' : '/api/offi-trades')
        : (isRent ? '/api/rents' : '/api/trades');
    fetch(`${endpointH}?codes=${selectedApt.regionCode}&start=${startYmH}&end=${endYmH}`)
      .then((res) => res.json())
      .then((json) => {
        const months2 = json?.months || [];
        const rows = [];
        months2.forEach((ym) => {
          (json?.data?.[`${selectedApt.regionCode}_${ym}`] || []).forEach((r) => {
            rows.push({ ...r, regionCode: selectedApt.regionCode });
          });
        });
        const filtered = rows.filter((t) => t.apt === selectedApt.apt && t.dong === selectedApt.dong);
        filtered.sort((a, b) => {
          const da = `${a.year}${String(a.month).padStart(2, '0')}${String(a.day).padStart(2, '0')}`;
          const db = `${b.year}${String(b.month).padStart(2, '0')}${String(b.day).padStart(2, '0')}`;
          return db.localeCompare(da);
        });
        setAptHistory(filtered);
        setAptHistoryFullRange(true);
      })
      .catch(() => {})
      .finally(() => setAptHistoryLoading(false));
  };

  // 매매를 보고 있어도 이 단지의 전세가율을 같이 보여주기 위해, 최근 12개월 전세 실거래를
  // 가볍게 따로 받아온다 (isRent가 이미 전세면 따로 받을 필요 없다).
  const [aptJeonseInfo, setAptJeonseInfo] = useState(null); // {avgDeposit, count} | null
  useEffect(() => {
    setAptJeonseInfo(null);
    if (!selectedApt || isRent || isSilv || propertyType === 'offi') return undefined;
    let cancelled = false;
    const endYmJ = ymNow();
    const startYmJ = ymShift(endYmJ, -11);
    fetch(`/api/rents?codes=${selectedApt.regionCode}&start=${startYmJ}&end=${endYmJ}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const months2 = json?.months || [];
        const rows = [];
        months2.forEach((ym) => {
          (json?.data?.[`${selectedApt.regionCode}_${ym}`] || []).forEach((r) => rows.push(r));
        });
        const matched = rows.filter((t) => t.apt === selectedApt.apt && t.dong === selectedApt.dong && t.isJeonse && t.deposit != null);
        if (matched.length === 0) return;
        const avgDeposit = matched.reduce((s, t) => s + t.deposit, 0) / matched.length;
        setAptJeonseInfo({ avgDeposit, count: matched.length });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedApt, isRent, isSilv, propertyType]);

  const [gongsiInfo, setGongsiInfo] = useState(null);
  const [gongsiLoading, setGongsiLoading] = useState(false);
  const [gongsiError, setGongsiError] = useState('');

  // 지형(경사도)·동지 일조 — 단지 좌표만 있으면 외부 키 없이 계산할 수 있다.
  // 경사도는 Open-Meteo 고도 API(무료, 키 불필요)로 중심점과 동·서·남·북 약 170m 지점의 고도를 읽어 추정한다.
  const [terrainInfo, setTerrainInfo] = useState(null);
  const [poiInfo, setPoiInfo] = useState(null);
  const [poiLoading, setPoiLoading] = useState(false);
  useEffect(() => {
    setPoiInfo(null);
    if (!selectedApt) return undefined;
    const centroid = findDongCentroid(selectedApt.regionCode, selectedApt.dong);
    const lat = selectedApt.lat ?? centroid?.lat;
    const lng = selectedApt.lng ?? centroid?.lng;
    if (lat == null || lng == null) return undefined;
    let cancelled = false;
    setPoiLoading(true);
    fetch(`/api/poi?lat=${lat}&lng=${lng}&radius=500`)
      .then((res) => res.json())
      .then((json) => { if (!cancelled && !json.error) setPoiInfo(json); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setPoiLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedApt]);
  const [terrainLoading, setTerrainLoading] = useState(false);
  useEffect(() => {
    setTerrainInfo(null);
    if (!selectedApt) return undefined;
    const centroid = findDongCentroid(selectedApt.regionCode, selectedApt.dong);
    const lat = selectedApt.lat ?? centroid?.lat;
    const lng = selectedApt.lng ?? centroid?.lng;
    if (lat == null || lng == null) return undefined;
    let cancelled = false;
    setTerrainLoading(true);
    (async () => {
      try {
        const dLat = 0.0015; // 약 166m
        const dLng = dLat / Math.max(0.2, Math.cos(lat * Math.PI / 180));
        const pts = [[lat, lng], [lat + dLat, lng], [lat - dLat, lng], [lat, lng + dLng], [lat, lng - dLng]];
        const qs = `latitude=${pts.map((p) => p[0].toFixed(5)).join(',')}&longitude=${pts.map((p) => p[1].toFixed(5)).join(',')}`;
        const res = await fetch(`https://api.open-meteo.com/v1/elevation?${qs}`);
        const json = await res.json();
        const el = Array.isArray(json?.elevation) ? json.elevation : null;
        if (cancelled || !el || el.length !== 5) return;
        const pairNs = Math.abs(el[1] - el[2]); // 남-북 두 지점(약 333m) 고도차
        const pairEw = Math.abs(el[3] - el[4]); // 동-서 두 지점 고도차
        const slope = Math.atan(Math.max(pairNs, pairEw) / 333) * 180 / Math.PI;
        setTerrainInfo({ lat, lng, center: el[0], el, slope });
      } catch (e) {
        // 고도 조회 실패 시에도 일조 계산은 좌표만으로 가능하게 한다.
        setTerrainInfo({ lat, lng, center: null, el: null, slope: null });
      } finally {
        if (!cancelled) setTerrainLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedApt]);

  const winterSun = useMemo(() => {
    if (!terrainInfo) return null;
    return computeWinterSun(terrainInfo.lat, terrainInfo.lng);
  }, [terrainInfo]);

  useEffect(() => {
    setGongsiInfo(null);
    setGongsiError('');
    if (!selectedApt || aptHistory.length === 0) return undefined;
    const withJibun = aptHistory.find((t) => t.jibun);
    if (!withJibun) return undefined;
    let cancelled = false;
    setGongsiLoading(true);
    const params = new URLSearchParams({
      regionCode: selectedApt.regionCode, dong: selectedApt.dong, jibun: withJibun.jibun,
    });
    if (withJibun.aptDong) params.set('aptDong', withJibun.aptDong);
    fetch(`/api/gongsi?${params.toString()}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json?.error) setGongsiError(json.error);
        else setGongsiInfo(json);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setGongsiLoading(false); });
    return () => { cancelled = true; };
  }, [selectedApt, aptHistory]);

  const nearestStationInfo = useMemo(() => {
    if (!selectedApt?.lat || !selectedApt?.lng) return null;
    return nearestStation(selectedApt.lat, selectedApt.lng);
  }, [selectedApt]);

  // 아실처럼 단지 상세 모달 상단에 핵심 요약(최근 3개월 평균가, 1년 전 대비, 3년 최고가)을 보여준다.
  const aptSummary = useMemo(() => {
    if (aptHistory.length === 0) return null;
    const priceOf = (t) => (isRent ? (t.isJeonse ? t.deposit : null) : t.amount);
    const ymOf = (t) => `${t.year}${String(t.month).padStart(2, '0')}`;
    const ym3 = ymShift(ymNow(), -2); // 이번 달 포함 최근 3개월
    const recent = aptHistory.filter((t) => ymOf(t) >= ym3);
    const recentPrices = recent.map(priceOf).filter((v) => v != null);
    const ym3PrevStart = ymShift(ymNow(), -5);
    const ym3PrevEnd = ymShift(ymNow(), -3);
    const prev3mo = aptHistory.filter((t) => ymOf(t) >= ym3PrevStart && ymOf(t) <= ym3PrevEnd);
    const volumeChangePct = prev3mo.length ? ((recent.length - prev3mo.length) / prev3mo.length) * 100 : null;
    const ymAgo = ymShift(ymNow(), -12);
    const yearAgo = aptHistory.filter((t) => ymOf(t) >= ymAgo && ymOf(t) <= ymShift(ymNow(), -10));
    const yearAgoPrices = yearAgo.map(priceOf).filter((v) => v != null);
    const recentAvg = recentPrices.length ? recentPrices.reduce((s, v) => s + v, 0) / recentPrices.length : null;
    const yearAgoAvg = yearAgoPrices.length ? yearAgoPrices.reduce((s, v) => s + v, 0) / yearAgoPrices.length : null;
    const yoyChange = recentAvg != null && yearAgoAvg ? ((recentAvg - yearAgoAvg) / yearAgoAvg) * 100 : null;
    // 비교 표본이 너무 적으면(어느 한쪽이 2건 이하) 등락률이 우연한 한두 건 차이일 수 있으므로
    // 화면에서 확정적인 변동률 대신 "표본 부족"이라고 알려주는 게 더 정직하다.
    const yoyLowSample = recentPrices.length < 3 || yearAgoPrices.length < 3;
    const sorted = [...aptHistory].sort((a, b) => (priceOf(b) ?? 0) - (priceOf(a) ?? 0));
    const maxTx = sorted[0];
    const ym12 = ymShift(ymNow(), -11);
    const last12moCount = aptHistory.filter((t) => ymOf(t) >= ym12).length;
    const households = aptBasicInfo?.households ? parseInt(String(aptBasicInfo.households).replace(/[^0-9]/g, ''), 10) : null;
    const turnoverRate = households ? (last12moCount / households) * 100 : null;
    return {
      recentAvg,
      recentCount: recent.length,
      yearAgoAvg,
      yoyChange,
      yoyLowSample,
      recentSampleN: recentPrices.length,
      yearAgoSampleN: yearAgoPrices.length,
      maxPrice: maxTx ? priceOf(maxTx) : null,
      maxLabel: maxTx ? `${fmtArea(maxTx.area)} · ${maxTx.year}.${String(maxTx.month).padStart(2, '0')}` : '-',
      turnoverRate,
      last12moCount,
      prev3moCount: prev3mo.length,
      volumeChangePct,
    };
  }, [aptHistory, isRent, aptBasicInfo]);

  // 같은 단지라도 전용면적(평형)마다 가격이 다르므로, 아실처럼 면적대별로 나눠서 볼 수 있게 한다.
  const aptHistoryAreaOptions = useMemo(() => {
    const groups = {};
    aptHistory.forEach((t) => {
      if (t.pyeong == null) return;
      const bucket = Math.floor(t.pyeong / 10) * 10;
      groups[bucket] = (groups[bucket] || 0) + 1;
    });
    return Object.keys(groups)
      .map(Number)
      .sort((a, b) => a - b)
      .map((b) => ({
        value: String(b),
        label: `${b}평대`,
        count: groups[b],
      }));
  }, [aptHistory]);

  const aptHistoryFiltered = useMemo(() => {
    if (historyAreaFilter === 'all') return aptHistory;
    const bucket = parseInt(historyAreaFilter, 10);
    return aptHistory.filter((t) => t.pyeong != null && Math.floor(t.pyeong / 10) * 10 === bucket);
  }, [aptHistory, historyAreaFilter]);

  // 이 단지의 역대 최고가·최저가, 고점 대비 하락폭, 최근 거래 간격을 계산한다.
  const aptDetailStats = useMemo(() => {
    const priceOf = (t) => (isRent ? (t.isJeonse ? t.deposit : null) : t.amount);
    const rows = aptHistoryFiltered.map((t) => ({ ...t, _price: priceOf(t) })).filter((t) => t._price != null);
    if (!rows.length) return null;
    const sorted = [...rows].sort((a, b) => {
      const da = `${a.year}${String(a.month).padStart(2, '0')}${String(a.day).padStart(2, '0')}`;
      const db = `${b.year}${String(b.month).padStart(2, '0')}${String(b.day).padStart(2, '0')}`;
      return db.localeCompare(da);
    });
    const latest = sorted[0];
    const high = Math.max(...rows.map((r) => r._price));
    const latestUnit = latest.pricePerPyeong ?? (latest.isJeonse ? latest.depositPerPyeong : null);
    const highUnit = Math.max(...rows.map((r) => (r.pricePerPyeong ?? (r.isJeonse ? r.depositPerPyeong : null))).filter((v) => v != null));
    const low = Math.min(...rows.map((r) => r._price));
    const drawdown = high ? ((latest._price - high) / high) * 100 : null;
    const recent5 = sorted.slice(0, 5).map((r) => r._price);
    const recentAvg = recent5.length ? recent5.reduce((a, b) => a + b, 0) / recent5.length : null;
    const dates = sorted.slice(0, 6).map((r) => new Date(Number(r.year), Number(r.month) - 1, Number(r.day || 1))).filter((d) => !Number.isNaN(d.getTime()));
    const gaps = [];
    for (let i = 1; i < dates.length; i += 1) gaps.push(Math.round((dates[i - 1] - dates[i]) / 86400000));
    const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
    return { latest, high, low, latestUnit, highUnit, drawdown, recentAvg, avgGap, count: rows.length };
  }, [aptHistoryFiltered, isRent]);

  const aptTrendData = useMemo(() => {
    const byMonth = {};
    aptHistoryFiltered.forEach((t) => {
      const ym = `${t.year}${String(t.month).padStart(2, '0')}`;
      const price = isRent ? (t.isJeonse ? t.deposit : null) : t.amount;
      if (price == null) return;
      if (!byMonth[ym]) byMonth[ym] = [];
      byMonth[ym].push(price);
    });
    return Object.keys(byMonth).sort().map((ym) => ({
      ym: monthLabel(ym),
      가격: Math.round(byMonth[ym].reduce((s, v) => s + v, 0) / byMonth[ym].length),
    }));
  }, [aptHistoryFiltered, isRent]);

  const aptVolumeData = useMemo(() => {
    const byMonth = {};
    aptHistoryFiltered.forEach((t) => {
      const ym = `${t.year}${String(t.month).padStart(2, '0')}`;
      byMonth[ym] = (byMonth[ym] || 0) + 1;
    });
    return Object.keys(byMonth).sort().map((ym) => ({ ym: monthLabel(ym), 건수: byMonth[ym] }));
  }, [aptHistoryFiltered]);

  // 평형대별로 겹쳐 볼 수 있는 다중 라인 데이터 — 한 그래프 안에서 30평대/40평대 등을 동시에 비교한다.
  const aptTrendByArea = useMemo(() => {
    if (aptHistoryAreaOptions.length < 2) return { data: [], seriesKeys: [] };
    const byMonth = {};
    aptHistory.forEach((t) => {
      if (t.pyeong == null) return;
      const price = isRent ? (t.isJeonse ? t.deposit : null) : t.amount;
      if (price == null) return;
      const bucket = Math.floor(t.pyeong / 10) * 10;
      const seriesKey = `${bucket}평대`;
      const ym = `${t.year}${String(t.month).padStart(2, '0')}`;
      ((byMonth[ym] ||= {})[seriesKey] ||= []).push(price);
    });
    const seriesKeys = aptHistoryAreaOptions.map((o) => o.label);
    const data = Object.keys(byMonth).sort().map((ym) => {
      const row = { ym: monthLabel(ym) };
      seriesKeys.forEach((k) => {
        const vals = byMonth[ym][k];
        row[k] = vals ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
      });
      return row;
    });
    return { data, seriesKeys };
  }, [aptHistory, aptHistoryAreaOptions, isRent]);

  // 단지별로 묶어서, 가장 최근 거래 기준으로 여러 단지를 한눈에 비교할 수 있는 목록.
  // 평당가(또는 전세는 보증금 평당가) 기준으로 정렬해서, 값이 비슷한 단지끼리 자연스럽게 이웃하게 둔다.
  const [complexSort, setComplexSort] = useState('price'); // 'price' | 'change' | 'recent'

  const complexCompare = useMemo(() => {
    const groups = {};
    allTxFiltered.forEach((t) => {
      const key = `${t.regionCode}|${t.dong}|${t.apt}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    const list = Object.values(groups).map((rows) => {
      rows.sort((a, b) => {
        const da = `${a.year}${String(a.month).padStart(2, '0')}${String(a.day).padStart(2, '0')}`;
        const db = `${b.year}${String(b.month).padStart(2, '0')}${String(b.day).padStart(2, '0')}`;
        return db.localeCompare(da);
      });
      const latest = rows[0];
      const earliest = rows[rows.length - 1];
      const unitPrice = isRent
        ? (latest.isJeonse ? latest.depositPerPyeong : null)
        : latest.pricePerPyeong;
      const earliestUnitPrice = isRent
        ? (earliest.isJeonse ? earliest.depositPerPyeong : null)
        : earliest.pricePerPyeong;
      const change = unitPrice && earliestUnitPrice
        ? ((unitPrice - earliestUnitPrice) / earliestUnitPrice) * 100
        : null;
      return { ...latest, count: rows.length, unitPrice, change, floorDist: (() => {
        const d = { low: 0, mid: 0, high: 0 };
        rows.forEach((r) => {
          const f = parseInt(r.floor, 10);
          if (!Number.isFinite(f)) return;
          if (f <= 10) d.low += 1;
          else if (f <= 20) d.mid += 1;
          else d.high += 1;
        });
        return d;
      })() };
    });
    const filtered = list.filter((r) => r.unitPrice != null);
    if (complexSort === 'change') {
      return filtered.sort((a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity));
    }
    if (complexSort === 'recent') {
      return filtered.sort((a, b) => {
        const da = `${a.year}${String(a.month).padStart(2, '0')}${String(a.day).padStart(2, '0')}`;
        const db = `${b.year}${String(b.month).padStart(2, '0')}${String(b.day).padStart(2, '0')}`;
        return db.localeCompare(da);
      });
    }
    return filtered.sort((a, b) => a.unitPrice - b.unitPrice);
  }, [allTxFiltered, isRent, complexSort]);

  // z-score 기반 저평가/고평가 참고 점수 — 같은 시/도 + 비슷한 평형(10평 단위)끼리 묶어서
  // 그 안에서 이 단지 평당가가 평균보다 얼마나 낮은지/높은지를 계산한다. 공식 시세 평가가
  // 아니라 "현재 조회된 데이터 안에서의 상대적 위치"를 보여주는 참고용 점수다.
  const complexValuation = useMemo(() => {
    const keyOf = (c) => `${c.regionCode}|${c.dong}|${c.apt}`;
    const groups = {};
    complexCompare.forEach((c) => {
      if (c.unitPrice == null || !c.pyeong) return;
      const gk = `${c.regionCode.slice(0, 2)}|${Math.round(c.pyeong / 10) * 10}`;
      (groups[gk] ||= []).push(c.unitPrice);
    });
    const stats = {};
    Object.entries(groups).forEach(([gk, vals]) => {
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
      stats[gk] = { mean, std: Math.sqrt(variance), n: vals.length };
    });
    const out = {};
    complexCompare.forEach((c) => {
      if (c.unitPrice == null || !c.pyeong) { out[keyOf(c)] = null; return; }
      const gk = `${c.regionCode.slice(0, 2)}|${Math.round(c.pyeong / 10) * 10}`;
      const s = stats[gk];
      out[keyOf(c)] = (!s || s.n < 3 || s.std === 0) ? null : (c.unitPrice - s.mean) / s.std;
    });
    return out;
  }, [complexCompare]);

  // 단지별 12개월 평당가 스파크라인 — 현재 조회 중인(선택 지역) 데이터 범위 안에서만 계산한다.
  const complexSparklines = useMemo(() => {
    const keyOf = (t) => `${t.regionCode}|${t.dong}|${t.apt}`;
    const groups = {};
    allTxFiltered.forEach((t) => {
      const v = isRent ? (t.isJeonse ? t.depositPerPyeong : null) : t.pricePerPyeong;
      if (v == null) return;
      const ym = `${t.year}${String(t.month).padStart(2, '0')}`;
      const k = keyOf(t);
      ((groups[k] ||= {})[ym] ||= []).push(v);
    });
    const out = {};
    Object.entries(groups).forEach(([k, byMonth]) => {
      const series = Object.keys(byMonth).sort().map((ym) => {
        const vals = byMonth[ym];
        return vals.reduce((s, v) => s + v, 0) / vals.length;
      });
      out[k] = series;
    });
    return out;
  }, [allTxFiltered, isRent]);

  const undervaluedPicks = useMemo(() => {
    return complexCompare
      .map((c) => ({ ...c, z: complexValuation[`${c.regionCode}|${c.dong}|${c.apt}`] }))
      .filter((c) => c.z != null && c.z <= -1)
      .sort((a, b) => a.z - b.z)
      .slice(0, 8);
  }, [complexCompare, complexValuation]);

  // 매매 ↔ 전세 비교: 현재 선택된 지역들의 최근월 매매 평당가와 전세 평당가를 나란히 본다.
  const crossDealStats = useMemo(() => {
    const out = [];
    selected.forEach((code) => {
      const saleSeries = monthlyByRegion[code] || [];
      const jeonseTx = [];
      expandRegionCode(code).forEach((mc) => {
        months.forEach((ym) => {
          (jeonseRaw?.[`${mc}_${ym}`] || []).forEach((r) => { if (r.isJeonse) jeonseTx.push(r); });
        });
      });
      const saleLatest = [...saleSeries].reverse().find((m) => m.avgPyeong != null);
      if (!saleLatest || jeonseTx.length === 0) return;
      const jeonseAvgPyeong = jeonseTx.reduce((s, r) => s + (r.depositPerPyeong || 0), 0) / jeonseTx.length;
      if (!jeonseAvgPyeong) return;
      out.push({
        code, name: labelFor(code), salePyeong: saleLatest.avgPyeong, jeonsePyeong: jeonseAvgPyeong,
        ratio: (jeonseAvgPyeong / saleLatest.avgPyeong) * 100,
      });
    });
    return out;
  }, [selected, monthlyByRegion, jeonseRaw, months]);

  const [analyticsMetric, setAnalyticsMetric] = useState('change');
  const [analyticsScope, setAnalyticsScope] = useState('region');
  const [analyticsPeriod, setAnalyticsPeriod] = useState('6'); // 3|6|12
  const [analyticsView, setAnalyticsView] = useState('overview'); // overview|compare|momentum|volume|highs

  // 시장분석센터: 같은 데이터에서 가격 모멘텀·거래강도·신고가·고점대비 하락폭을 함께 계산한다.
  const advancedAnalytics = useMemo(() => {
    const cutoff = ymShift(endYm, -(parseInt(analyticsPeriod, 10) - 1));
    const tx = allTx.filter((t) => {
      const ym = `${t.year}${String(t.month).padStart(2, '0')}`;
      return ym >= cutoff && ym <= endYm;
    });
    const priceOf = (t) => (isRent ? (t.isJeonse ? t.deposit : null) : t.amount);
    const keyOf = (t) => `${t.regionCode}|${t.dong}|${t.apt}`;
    const groups = {};
    tx.forEach((t) => { const k = keyOf(t); (groups[k] ||= []).push(t); });
    const rows = Object.entries(groups).map(([key, rows0]) => {
      const rowsSorted = [...rows0].filter((r) => priceOf(r) != null).sort((a, b) => `${a.year}${String(a.month).padStart(2, '0')}${String(a.day).padStart(2, '0')}`.localeCompare(`${b.year}${String(b.month).padStart(2, '0')}${String(b.day).padStart(2, '0')}`));
      if (!rowsSorted.length) return null;
      const latest = rowsSorted[rowsSorted.length - 1];
      const prev = rowsSorted.length > 1 ? rowsSorted[rowsSorted.length - 2] : null;
      const prices = rowsSorted.map(priceOf).filter((v) => v != null);
      const high = Math.max(...prices);
      const current = priceOf(latest);
      const first = priceOf(rowsSorted[0]);
      const change = first ? ((current - first) / first) * 100 : null;
      const mom = prev && priceOf(prev) ? ((current - priceOf(prev)) / priceOf(prev)) * 100 : null;
      const newHigh = current >= high && rowsSorted.length >= 2;
      return {
        key, apt: latest.apt, dong: latest.dong, regionCode: latest.regionCode, latest: current,
        unitPrice: latest.pricePerPyeong, volume: rowsSorted.length, change, mom, high,
        drawdown: high ? ((current - high) / high) * 100 : null, newHigh,
      };
    }).filter(Boolean);
    const monthly = {};
    tx.forEach((t) => { const ym = `${t.year}${String(t.month).padStart(2, '0')}`; monthly[ym] = (monthly[ym] || 0) + 1; });
    const monthSeries = Object.keys(monthly).sort().map((ym) => ({ ym: monthLabel(ym), 건수: monthly[ym] }));
    const highs = rows.filter((r) => r.newHigh).sort((a, b) => (b.mom ?? -Infinity) - (a.mom ?? -Infinity)).slice(0, 30);
    const momentum = [...rows].filter((r) => r.mom != null).sort((a, b) => b.mom - a.mom).slice(0, 30);
    const drawdowns = [...rows].filter((r) => r.drawdown != null && r.drawdown < 0).sort((a, b) => a.drawdown - b.drawdown).slice(0, 30);
    const volumeLeaders = [...rows].sort((a, b) => b.volume - a.volume).slice(0, 30);
    return { tx, rows, monthSeries, highs, momentum, drawdowns, volumeLeaders, cutoff };
  }, [allTx, isRent, endYm, analyticsPeriod]);

  // "시장강도" — 가격·거래량 변화를 기간을 반으로 나눠 전반/후반으로 비교한다. 전세가율은
  // "전세가율" 거래유형으로 조회했을 때만 값이 있어서, 없으면 안내만 하고 억지로 채우지 않는다.
  const marketIntensity = useMemo(() => {
    const tx = advancedAnalytics.tx;
    if (tx.length === 0) return null;
    const priceOf = (t) => (isRent ? (t.isJeonse ? t.deposit : null) : t.amount);
    const sortedYm = [...new Set(tx.map((t) => `${t.year}${String(t.month).padStart(2, '0')}`))].sort();
    if (sortedYm.length < 2) return null;
    const mid = sortedYm[Math.floor(sortedYm.length / 2)];
    const firstHalf = tx.filter((t) => `${t.year}${String(t.month).padStart(2, '0')}` < mid);
    const secondHalf = tx.filter((t) => `${t.year}${String(t.month).padStart(2, '0')}` >= mid);
    const avgPrice = (rows) => {
      const vals = rows.map(priceOf).filter((v) => v != null);
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    };
    const p1 = avgPrice(firstHalf);
    const p2 = avgPrice(secondHalf);
    const priceChangePct = (p1 && p2) ? ((p2 - p1) / p1) * 100 : null;
    const volumeChangePct = firstHalf.length ? ((secondHalf.length - firstHalf.length) / firstHalf.length) * 100 : null;
    return {
      priceChangePct, volumeChangePct,
      firstHalfCount: firstHalf.length, secondHalfCount: secondHalf.length,
      periodLabel: `${monthLabel(sortedYm[0])} ~ ${monthLabel(sortedYm[sortedYm.length - 1])}`,
    };
  }, [advancedAnalytics, isRent]);


  const analyticsRows = useMemo(() => {
    const rows = [];
    if (analyticsScope === 'region') {
      selected.forEach((code) => {
        const series = monthlyByRegion[code] || [];
        const valid = series.filter((m) => m.avgPyeong != null);
        const first = valid[0]; const last = valid[valid.length - 1];
        const change = first?.avgPyeong ? ((last.avgPyeong - first.avgPyeong) / first.avgPyeong) * 100 : null;
        const volume = series.reduce((sum, m) => sum + (m.count || 0), 0);
        const prices = [];
        series.forEach((m) => (rawByRegionMonth[`${code}_${m.ym}`] || []).forEach((t) => {
          const v = isRent ? (t.isJeonse ? t.deposit : null) : t.amount; if (v != null) prices.push(v);
        }));
        rows.push({
          key: code, name: labelFor(code), latest: last?.avgPyeong ?? null, change, volume,
          min: prices.length ? Math.min(...prices) : null, max: prices.length ? Math.max(...prices) : null,
        });
      });
    } else {
      const groups = {};
      allTx.forEach((t) => {
        const key = `${t.regionCode}|${t.dong}|${t.apt}`;
        (groups[key] ||= []).push(t);
      });
      Object.entries(groups).forEach(([key, txs]) => {
        const ordered = [...txs].sort((a, b) => `${b.year}${String(b.month).padStart(2, '0')}${String(b.day).padStart(2, '0')}`.localeCompare(`${a.year}${String(a.month).padStart(2, '0')}${String(a.day).padStart(2, '0')}`));
        const latest = ordered[0]; const oldest = ordered[ordered.length - 1];
        const lp = isRent ? (latest.isJeonse ? latest.depositPerPyeong : null) : latest.pricePerPyeong;
        const op = isRent ? (oldest.isJeonse ? oldest.depositPerPyeong : null) : oldest.pricePerPyeong;
        const prices = txs.map((t) => (isRent ? (t.isJeonse ? t.deposit : null) : t.amount)).filter((v) => v != null);
        rows.push({
          key, name: latest.apt, sub: `${labelFor(latest.regionCode)} · ${latest.dong}`,
          latest: lp, change: lp != null && op ? ((lp - op) / op) * 100 : null, volume: txs.length,
          min: prices.length ? Math.min(...prices) : null, max: prices.length ? Math.max(...prices) : null,
          apt: latest.apt, dong: latest.dong, regionCode: latest.regionCode,
        });
      });
    }
    return rows.filter((r) => r.latest != null || r.volume > 0);
  }, [analyticsScope, selected, monthlyByRegion, rawByRegionMonth, allTx, isRent]);

  const analyticsSorted = useMemo(() => {
    const arr = [...analyticsRows];
    if (analyticsMetric === 'price') return arr.sort((a, b) => (b.latest ?? -Infinity) - (a.latest ?? -Infinity));
    if (analyticsMetric === 'volume') return arr.sort((a, b) => b.volume - a.volume);
    if (analyticsMetric === 'range') return arr.sort((a, b) => ((b.max - b.min) || 0) - ((a.max - a.min) || 0));
    return arr.sort((a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity));
  }, [analyticsRows, analyticsMetric]);

  const analyticsKpis = useMemo(() => {
    const withPrice = analyticsRows.filter((r) => r.latest != null);
    const avg = withPrice.length ? withPrice.reduce((s, r) => s + r.latest, 0) / withPrice.length : null;
    const volume = analyticsRows.reduce((s, r) => s + r.volume, 0);
    const changes = analyticsRows.map((r) => r.change).filter((v) => v != null).sort((a, b) => a - b);
    return { avg, volume, median: changes.length ? changes[Math.floor(changes.length / 2)] : null, count: analyticsRows.length };
  }, [analyticsRows]);

  const marketSignals = useMemo(() => {
    const monthsN = Math.max(1, parseInt(analyticsPeriod, 10) || 6);
    const cutoff = ymShift(endYm, -(monthsN - 1));
    const priceOf = (t) => (isRent ? (t.isJeonse ? t.deposit : null) : t.amount);
    const tx = allTx.filter((t) => {
      const ym = `${t.year}${String(t.month).padStart(2, '0')}`;
      return ym >= cutoff && ym <= endYm;
    });
    const byMonth = {};
    tx.forEach((t) => {
      const v = priceOf(t); if (v == null) return;
      const ym = `${t.year}${String(t.month).padStart(2, '0')}`;
      (byMonth[ym] ||= []).push(v);
    });
    const monthly = Object.keys(byMonth).sort().map((ym) => {
      const vals = byMonth[ym].slice().sort((a, b) => a - b);
      return { ym, count: vals.length, median: vals[Math.floor(vals.length / 2)] ?? null };
    });
    const split = Math.max(1, Math.floor(monthly.length / 2));
    const prev = monthly.slice(0, split).reduce((s, r) => s + r.count, 0);
    const recent = monthly.slice(split).reduce((s, r) => s + r.count, 0);
    const volumeChange = prev ? ((recent - prev) / prev) * 100 : null;
    const vals = tx.map(priceOf).filter(Number.isFinite).sort((a, b) => a - b);
    const q = (ratio) => (vals.length ? vals[Math.floor((vals.length - 1) * ratio)] : null);
    const median = q(0.5); const p25 = q(0.25); const p75 = q(0.75);
    const last = monthly.at(-1); const before = monthly.at(-2);
    const monthlyPriceChange = last?.median && before?.median ? ((last.median - before.median) / before.median) * 100 : null;
    return { monthly, prev, recent, volumeChange, median, p25, p75, spread: p25 && p75 ? ((p75 - p25) / p25) * 100 : null, monthlyPriceChange };
  }, [allTx, endYm, analyticsPeriod, isRent]);

  const [fullComplexList, setFullComplexList] = useState([]);

  useEffect(() => {
    if (selected.length === 0) { setFullComplexList([]); return undefined; }
    let cancelled = false;
    fetch(`/api/apt-list?codes=${selected.join(',')}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const list = [];
        Object.entries(json?.data || {}).forEach(([code, items]) => {
          (items || []).forEach((it) => {
            list.push({ apt: it.kaptName, dong: it.dong, regionCode: code });
          });
        });
        setFullComplexList(list);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selected]);

  const [dongRawFeatures, setDongRawFeatures] = useState([]);

  // "동" 경계 도형의 중심점을 좌표로 재사용한다 — 이미 "동" 색칠 기능을 위해 받아둔 데이터라서,
  // 단지 하나하나를 카카오에 검색하지 않고도 즉시 대략적인 위치를 알 수 있다(동 단위 정밀도).
  const dongCentroids = useMemo(() => {
    const out = {};
    dongRawFeatures.forEach((f) => {
      const geom = f.feature?.geometry;
      const ring = geom?.type === 'Polygon' ? geom.coordinates?.[0] : geom?.coordinates?.[0]?.[0];
      if (!ring?.length) return;
      let sx = 0; let sy = 0;
      ring.forEach(([lng, lat]) => { sx += lng; sy += lat; });
      out[`${f.regionCode}|${normalizeDongName(f.name)}`] = { lat: sy / ring.length, lng: sx / ring.length };
    });
    return out;
  }, [dongRawFeatures]);

  // 법정동/행정동 이름이 안 맞을 때(예: 광안동 ↔ 광안4동), 매번 dongCentroids 전체를 훑지 않고
  // "root(숫자 뗀 동 이름)" 기준으로 미리 인덱스를 만들어 O(1)로 찾는다.
  const dongCentroidRootIndex = useMemo(() => {
    const index = new Map();
    Object.entries(dongCentroids).forEach(([key, coord]) => {
      const sep = key.indexOf('|');
      if (sep < 0) return;
      const regionCode = key.slice(0, sep);
      const dong = key.slice(sep + 1);
      const root = dong.replace(/동$/, '');
      if (!root) return;
      const rootKey = `${regionCode}|${root}`;
      const prev = index.get(rootKey);
      if (prev) {
        prev.lat += coord.lat; prev.lng += coord.lng; prev.count += 1;
      } else {
        index.set(rootKey, { lat: coord.lat, lng: coord.lng, count: 1 });
      }
    });
    index.forEach((v) => { v.lat /= v.count; v.lng /= v.count; });
    return index;
  }, [dongCentroids]);

  const findDongCentroid = (regionCode, dong) => {
    const normalized = normalizeDongName(dong);
    const exact = dongCentroids[`${regionCode}|${normalized}`];
    if (exact) return exact;
    // 국토부 실거래 데이터는 "법정동"(예: 광안동), 동 경계 지도는 "행정동"(예: 광안4동) 기준이라
    // 이름이 정확히 안 맞는 경우가 있다 — 미리 만들어둔 root 인덱스에서 바로 찾는다.
    const root = normalized.replace(/동$/, '');
    if (!root) return null;
    const hit = dongCentroidRootIndex.get(`${regionCode}|${root}`);
    return hit ? { lat: hit.lat, lng: hit.lng } : null;
  };

  const MAX_MAP_COMPLEXES = 800;

  const mapComplexes = useMemo(() => {
    const seen = new Set();
    const list = [];
    const latestByKey = new Map();
    allTxFiltered.forEach((t) => {
      const key = `${t.regionCode}|${t.dong}|${t.apt}`;
      const price = isRent ? (t.isJeonse ? t.deposit : null) : t.amount;
      const ym = `${t.year}${String(t.month).padStart(2, '0')}${String(t.day ?? 0).padStart(2, '0')}`;
      const prev = latestByKey.get(key);
      if (price != null && (!prev || ym > prev.ym)) {
        latestByKey.set(key, { ym, price, pyeong: isRent ? t.depositPerPyeong : t.pricePerPyeong, area: t.area });
      }
    });
    const addItem = (apt, dong, regionCode) => {
      if (!apt || !dong || !regionCode) return;
      const key = `${regionCode}|${dong}|${apt}`;
      if (seen.has(key)) return;
      seen.add(key);
      const coord = findDongCentroid(regionCode, dong);
      const latest = latestByKey.get(key);
      list.push({ key, apt, dong, regionCode, regionName: regionLabel(regionCode), lat: coord?.lat, lng: coord?.lng, latestPrice: latest?.price, latestPyeong: latest?.pyeong, latestArea: latest?.area });
    };
    // 실거래가 있는 단지를 먼저 채우고, 남는 자리만큼만 나머지 단지로 채운다.
    // 좌표가 이미(동 중심점으로) 확보된 단지는 카카오 검색이 필요 없어 훨씬 가볍다.
    allTxFiltered.forEach((t) => addItem(t.apt, t.dong, t.regionCode));
    for (const c of fullComplexList) {
      if (list.length >= MAX_MAP_COMPLEXES) break;
      if (dongFilter !== 'all' && c.dong !== dongFilter) continue;
      addItem(c.apt, c.dong, c.regionCode);
    }
    return list.slice(0, MAX_MAP_COMPLEXES);
  }, [allTxFiltered, fullComplexList, dongCentroids, dongFilter, isRent]);

  const mapComplexCoordByKey = useMemo(() => new Map(mapComplexes.map((c) => [c.key, c])), [mapComplexes]);

  const [budgetSearchOpen, setBudgetSearchOpen] = useState(false);
  const [priceMoveFilter, setPriceMoveFilter] = useState('all'); // 'all' | 'high' | 'drop'
  const [mapFocusKeys, setMapFocusKeys] = useState(null); // Set<string> | null
  const [budgetAmount, setBudgetAmount] = useState('');
  const [mapViewportBounds, setMapViewportBounds] = useState(null); // {swLat,swLng,neLat,neLng} | null
  const [subwayLayerOn, setSubwayLayerOn] = useState(false);
  const [visibleMarkerCount, setVisibleMarkerCount] = useState(null);

  // 지금 보고 있는 단지 주변(반경 내) 다른 단지들을 자동으로 찾아 비교한다 (아실/호갱노노 스타일).
  const nearbyComplexes = useMemo(() => {
    if (!selectedApt) return [];
    const selfKey = `${selectedApt.regionCode}|${selectedApt.dong}|${selectedApt.apt}`;
    const selfCoord = (selectedApt.lat != null && selectedApt.lng != null)
      ? { lat: selectedApt.lat, lng: selectedApt.lng }
      : findDongCentroid(selectedApt.regionCode, selectedApt.dong);
    if (!selfCoord) return [];
    return mapComplexes
      .filter((c) => c.key !== selfKey && c.lat != null && c.lng != null)
      .map((c) => ({ ...c, distance: distanceMeters(selfCoord.lat, selfCoord.lng, c.lat, c.lng) }))
      .filter((c) => c.distance <= nearbyRadius)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 20);
  }, [selectedApt, mapComplexes, nearbyRadius]);

  // 반경 500m/1km/2km 별로 단지 개수·평균가·거래량을 한 번에 요약한다.
  const radiusSummary = useMemo(() => {
    if (!selectedApt) return null;
    const selfKey = `${selectedApt.regionCode}|${selectedApt.dong}|${selectedApt.apt}`;
    const selfCoord = (selectedApt.lat != null && selectedApt.lng != null)
      ? { lat: selectedApt.lat, lng: selectedApt.lng }
      : findDongCentroid(selectedApt.regionCode, selectedApt.dong);
    if (!selfCoord) return null;
    const withDist = mapComplexes
      .filter((c) => c.key !== selfKey && c.lat != null && c.lng != null)
      .map((c) => ({ ...c, distance: distanceMeters(selfCoord.lat, selfCoord.lng, c.lat, c.lng) }));
    return [500, 1000, 2000].map((r) => {
      const within = withDist.filter((c) => c.distance <= r);
      const priced = within.filter((c) => c.latestPrice != null);
      const avg = priced.length ? priced.reduce((s, c) => s + c.latestPrice, 0) / priced.length : null;
      return { radius: r, count: within.length, avg };
    });
  }, [selectedApt, mapComplexes]);

  // "비슷한 단지"라고 단정하지 않고, 평형(±5평)이 비슷한 단지 중 평당가가 가까운 순으로
  // "비교 조건이 유사한 단지"를 찾는다 — 준공연도·세대수까지 반영한 정교한 유사도는 아니다.
  // 평형·가격뿐 아니라 거리까지 반영해서 "비슷한 조건"을 찾고, 왜 추천됐는지 이유(거리·평형차·가격차)를
  // 같이 계산해둔다 — 세대수·준공연도는 현재 열어본 단지에만 있어서 전체 비교에는 아직 못 쓴다.
  const similarComplexes = useMemo(() => {
    if (!selectedApt) return [];
    const selfKey = `${selectedApt.regionCode}|${selectedApt.dong}|${selectedApt.apt}`;
    const self = complexCompare.find((c) => `${c.regionCode}|${c.dong}|${c.apt}` === selfKey);
    if (!self || self.unitPrice == null || self.pyeong == null) return [];
    const selfCoord = mapComplexCoordByKey.get(selfKey);
    return complexCompare
      .filter((c) => `${c.regionCode}|${c.dong}|${c.apt}` !== selfKey)
      .filter((c) => c.unitPrice != null && c.pyeong != null && Math.abs(c.pyeong - self.pyeong) <= 5)
      .map((c) => {
        const cCoord = mapComplexCoordByKey.get(`${c.regionCode}|${c.dong}|${c.apt}`);
        const distance = (selfCoord && cCoord) ? distanceMeters(selfCoord.lat, selfCoord.lng, cCoord.lat, cCoord.lng) : null;
        const priceDiffPct = ((c.unitPrice - self.unitPrice) / self.unitPrice) * 100;
        const pyeongDiff = c.pyeong - self.pyeong;
        // 점수가 낮을수록 "더 비슷함" — 가격차(%)·거리(km로 환산)·평형차를 단순 합산한다.
        const score = Math.abs(priceDiffPct) + (distance != null ? distance / 1000 : 3) * 2 + Math.abs(pyeongDiff) * 0.5;
        return { ...c, priceDiffPct, pyeongDiff, distance, score };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 6);
  }, [selectedApt, complexCompare, mapComplexCoordByKey]);

  // "이 가격에 살 수 있는 단지" 역지도 — 예산을 넣으면 그 이하 단지만 남긴다.
  const budgetMatches = useMemo(() => {
    if (!budgetSearchOpen || !budgetAmount) return null;
    const maxManwon = parseFloat(budgetAmount) * 10000;
    if (!Number.isFinite(maxManwon) || maxManwon <= 0) return null;
    return mapComplexes
      .filter((c) => c.latestPrice != null && c.latestPrice <= maxManwon)
      .sort((a, b) => b.latestPrice - a.latestPrice);
  }, [budgetSearchOpen, budgetAmount, mapComplexes]);

  // 신고가/하락 단지만 지도에 남긴다 — complexCompare의 최근 거래 대비 변동률(change)을 기준으로 한다.
  // 사용자가 적어둔 매물 호가를, 현재 조회된 실거래 중 같은 단지명·비슷한 면적의 최근 거래와 비교한다.
  // 호가를 같은 단지·비슷한 전용면적(±3㎡)·비슷한 층(±5층, 층 정보가 있을 때)의 실제 거래와 비교한다.
  // 맞는 거래가 2건 미만이면 억지로 추정하지 않고 "비교 자료 부족"으로 표시한다.
  const myListingsWithComparison = useMemo(() => myListings.map((l) => {
    const areaNum = l.area ? parseFloat(l.area) : null;
    const floorNum = l.floor ? parseInt(l.floor, 10) : null;
    const priceManwon = parseFloat(l.price) * 10000;
    if (isRent || isRatio || isRone) {
      return { ...l, comparable: false, reason: '매매 조회 상태에서 비교할 수 있어요.', priceManwon };
    }
    const matched = allTxFiltered
      .filter((t) => t.apt === l.apt && (!l.dong || t.dong === l.dong))
      .filter((t) => !areaNum || t.area == null || Math.abs(t.area - areaNum) <= 3)
      .filter((t) => {
        if (floorNum == null || !Number.isFinite(floorNum)) return true;
        const f = parseInt(t.floor, 10);
        return !Number.isFinite(f) || Math.abs(f - floorNum) <= 5;
      })
      .filter((t) => t.amount != null)
      .sort((a, b) => {
        const da = `${a.year}${String(a.month).padStart(2, '0')}${String(a.day ?? 0).padStart(2, '0')}`;
        const db = `${b.year}${String(b.month).padStart(2, '0')}${String(b.day ?? 0).padStart(2, '0')}`;
        return db.localeCompare(da);
      });
    if (matched.length < 2) {
      return { ...l, comparable: false, matchCount: matched.length, reason: '비교 자료 부족 (같은 단지·비슷한 면적/층 거래 2건 미만)', priceManwon };
    }
    const recent = matched.slice(0, 5);
    const avg = recent.reduce((sum, t) => sum + t.amount, 0) / recent.length;
    const latest = matched[0];
    const nowYm = ymNow();
    const monthsAgo = (parseInt(nowYm.slice(0, 4), 10) * 12 + parseInt(nowYm.slice(4), 10))
      - (latest.year * 12 + latest.month);
    const diff = priceManwon - avg;
    return {
      ...l, comparable: true, matchCount: matched.length, usedCount: recent.length, avg, diff, priceManwon,
      diffPct: (diff / avg) * 100, latestYm: `${latest.year}.${String(latest.month).padStart(2, '0')}`, monthsAgo,
      matchedRegionCode: latest.regionCode, matchedDong: latest.dong,
    };
  }), [myListings, allTxFiltered, isRent, isRatio, isRone]);

  const priceMoveMatches = useMemo(() => {
    if (priceMoveFilter === 'all') return null;
    const changeByKey = new Map(complexCompare.map((c) => [`${c.regionCode}|${c.dong}|${c.apt}`, c.change]));
    return mapComplexes.filter((c) => {
      const change = changeByKey.get(c.key);
      if (change == null) return false;
      return priceMoveFilter === 'high' ? change >= 5 : change <= -5;
    });
  }, [priceMoveFilter, mapComplexes, complexCompare]);

  // "비교 조건이 유사한 단지"나 "주변 단지"에서 "지도에서 보기"를 누르면, 그 단지들만 지도에 남긴다.
  const mapFocusMatches = useMemo(() => {
    if (!mapFocusKeys) return null;
    return mapComplexes.filter((c) => mapFocusKeys.has(c.key));
  }, [mapFocusKeys, mapComplexes]);

  // "단지 탐색" 패널을 현재 지도 화면 범위에 맞춰 보여준다 — 지도를 옮기면 목록도 같이 바뀐다.
  // 지도 화면 범위 안의 지하철역만 골라서 레이어로 보여준다 (전국 역을 다 그리면 무거워진다).
  const visibleStations = useMemo(() => {
    if (!subwayLayerOn || !mapViewportBounds) return [];
    return allStations().filter((s) => (
      s.lat >= mapViewportBounds.swLat && s.lat <= mapViewportBounds.neLat
      && s.lng >= mapViewportBounds.swLng && s.lng <= mapViewportBounds.neLng
    )).slice(0, 200);
  }, [subwayLayerOn, mapViewportBounds]);

  const mapPanelList = useMemo(() => {
    if (!mapViewportBounds) return complexCompare.slice(0, 40);
    const filtered = complexCompare.filter((c) => {
      const m = mapComplexCoordByKey.get(`${c.regionCode}|${c.dong}|${c.apt}`);
      if (!m || m.lat == null || m.lng == null) return false;
      return m.lat >= mapViewportBounds.swLat && m.lat <= mapViewportBounds.neLat
        && m.lng >= mapViewportBounds.swLng && m.lng <= mapViewportBounds.neLng;
    });
    return filtered.slice(0, 60);
  }, [complexCompare, mapComplexCoordByKey, mapViewportBounds]);

  const [globalSearch, setGlobalSearch] = useState('');

  // 조회해둔 거래 내역 안에서 단지 이름을 바로 찾아보는 사이드바 검색 (아실 앱의 단지 검색처럼).
  const [complexSearch, setComplexSearch] = useState('');
  const complexSearchResults = useMemo(() => {
    const q = complexSearch.trim();
    if (!q) return [];
    const seen = new Set();
    const out = [];
    allTxFiltered.forEach((t) => {
      if (!t.apt?.includes(q)) return;
      const key = `${t.regionCode}|${t.dong}|${t.apt}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ key, apt: t.apt, dong: t.dong, regionCode: t.regionCode });
    });
    return out;
  }, [complexSearch, allTxFiltered]);
  const [globalSearchMsg, setGlobalSearchMsg] = useState('');

  const handleGlobalSearch = () => {
    const q = globalSearch.trim();
    if (!q) return;

    const aggMatch = SIDO_AGGREGATES.find((a) => a.name.includes(q) || q.includes(a.name.replace(' 전체', '')));
    if (aggMatch) {
      addRegionAndFetch(aggMatch.code);
      setViewMode('map');
      setGlobalSearchMsg('');
      return;
    }
    for (const g of REGION_GROUPS) {
      const item = g.items.find((it) => it.name.includes(q) || q.includes(it.name));
      if (item) {
        addRegionAndFetch(item.code);
        setViewMode('map');
        setGlobalSearchMsg('');
        return;
      }
    }
    const complexMatch = mapComplexes.find((c) => c.apt.includes(q) || q.includes(c.apt));
    if (complexMatch) {
      const coord = codeToLatLng[complexMatch.regionCode];
      setSelectedApt({
        apt: complexMatch.apt, dong: complexMatch.dong, regionCode: complexMatch.regionCode,
        lat: coord?.lat, lng: coord?.lng,
      });
      setGlobalSearchMsg('');
      return;
    }
    setGlobalSearchMsg('찾을 수 없어요. 지도에서 지역을 먼저 선택해보세요.');
  };

  const [compareAKey, setCompareAKey] = useState('');
  const [compareBKey, setCompareBKey] = useState('');
  const [compareCKey, setCompareCKey] = useState('');

  const compareOptions = useMemo(() => {
    const regionOpts = selected.map((code) => ({
      value: `region:${code}`, kind: 'region', code, label: labelFor(code),
    }));
    const seen = new Set();
    const aptOpts = [];
    allTx.forEach((t) => {
      const key = `${t.regionCode}|${t.dong}|${t.apt}`;
      if (seen.has(key)) return;
      seen.add(key);
      aptOpts.push({
        value: `apt:${key}`, kind: 'apt', apt: t.apt, dong: t.dong, regionCode: t.regionCode,
        label: `${t.apt} (${regionLabel(t.regionCode)} ${t.dong})`,
      });
    });
    return [...regionOpts, ...aptOpts];
  }, [selected, allTx]);

  const getCompareResult = (key) => {
    const opt = compareOptions.find((o) => o.value === key);
    if (!opt) return { label: null, series: [], changePct: null, latest: null, min: null, max: null, count: 0, avgArea: null };
    const rowsByMonth = [];
    const series = months.map((ym) => {
      let rows;
      if (opt.kind === 'region') {
        rows = rawByRegionMonth[`${opt.code}_${ym}`] || [];
      } else {
        rows = (rawByRegionMonth[`${opt.regionCode}_${ym}`] || [])
          .filter((r) => r.apt === opt.apt && r.dong === opt.dong);
      }
      rowsByMonth.push(...rows);
      const valid = rows
        .map((r) => (isRent ? (r.isJeonse ? r.depositPerPyeong : null) : r.pricePerPyeong))
        .filter((v) => v != null);
      const value = valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
      return { ym, value };
    });
    const withData = series.filter((s) => s.value != null);
    const first = withData[0];
    const last = withData[withData.length - 1];
    const changePct = first && last && first.value ? ((last.value - first.value) / first.value) * 100 : null;

    const prices = rowsByMonth
      .map((r) => (isRent ? (r.isJeonse ? r.deposit : null) : r.amount))
      .filter((v) => v != null);
    const areas = rowsByMonth.map((r) => r.area).filter((v) => v != null);
    return {
      label: opt.label,
      series,
      changePct,
      latest: last?.value ?? null,
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null,
      count: rowsByMonth.length,
      avgArea: areas.length ? areas.reduce((s, v) => s + v, 0) / areas.length : null,
    };
  };

  const compareAResult = useMemo(() => getCompareResult(compareAKey), [compareAKey, compareOptions, months, rawByRegionMonth, isRent]);
  const compareBResult = useMemo(() => getCompareResult(compareBKey), [compareBKey, compareOptions, months, rawByRegionMonth, isRent]);
  const compareCResult = useMemo(() => getCompareResult(compareCKey), [compareCKey, compareOptions, months, rawByRegionMonth, isRent]);

  const compareChartData = useMemo(() => {
    return months.map((ym) => {
      const row = { ym: monthLabel(ym) };
      [compareAResult, compareBResult, compareCResult].forEach((r) => {
        if (r.label) row[r.label] = r.series.find((s) => s.ym === ym)?.value ?? null;
      });
      return row;
    });
  }, [months, compareAResult, compareBResult, compareCResult]);

  const compareResultsList = [compareAResult, compareBResult, compareCResult].filter((r) => r.label);
  const compareBarData = compareResultsList.map((r) => ({ name: r.label, 평당가: r.latest ? Math.round(r.latest / 10) / 100 : 0 }));

  const roneChartData = useMemo(() => {
    return roneMonths.map((ym) => {
      const row = { ym: monthLabel(ym) };
      selected.forEach((code) => {
        const point = (roneSeries[code] || []).find((p) => p.ym === ym);
        row[labelFor(code)] = point ? Math.round(point.value) : null;
      });
      return row;
    });
  }, [roneMonths, selected, roneSeries]);

  const roneRanking = useMemo(() => {
    return selected.map((code) => {
      const series = roneSeries[code] || [];
      const first = series[0];
      const last = series[series.length - 1];
      const change = first && last && first.value
        ? ((last.value - first.value) / first.value) * 100
        : null;
      return {
        code, name: labelFor(code), latest: last?.value ?? null, unit: last?.unit, change,
        unsupported: !!roneUnmapped.includes(code),
      };
    }).sort((a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity));
  }, [selected, roneSeries, roneUnmapped]);

  const roneKpis = useMemo(() => {
    const withVal = roneRanking.filter((r) => r.latest != null);
    const avg = withVal.length ? withVal.reduce((s, r) => s + r.latest, 0) / withVal.length : null;
    const rising = roneRanking.filter((r) => r.change != null).sort((a, b) => b.change - a.change)[0];
    const falling = roneRanking.filter((r) => r.change != null).sort((a, b) => a.change - b.change)[0];
    return { avg, rising, falling, unit: withVal[0]?.unit };
  }, [roneRanking]);

  const ratioByRegion = useMemo(() => {
    const out = {};
    selected.forEach((code) => {
      out[code] = months.map((ym) => {
        const saleItems = saleRaw[`${code}_${ym}`] || [];
        const jeonseItems = (jeonseRaw[`${code}_${ym}`] || []).filter((r) => r.isJeonse);
        const avgSale = saleItems.length
          ? saleItems.reduce((s, r) => s + r.amount, 0) / saleItems.length
          : null;
        const avgJeonse = jeonseItems.length
          ? jeonseItems.reduce((s, r) => s + r.deposit, 0) / jeonseItems.length
          : null;
        const ratio = avgSale && avgJeonse ? (avgJeonse / avgSale) * 100 : null;
        return { ym, avgSale, avgJeonse, ratio };
      });
    });
    return out;
  }, [selected, months, saleRaw, jeonseRaw]);

  const ratioChartData = useMemo(() => {
    return months.map((ym) => {
      const row = { ym: monthLabel(ym) };
      selected.forEach((code) => {
        const point = (ratioByRegion[code] || []).find((p) => p.ym === ym);
        row[labelFor(code)] = point?.ratio != null ? Math.round(point.ratio * 10) / 10 : null;
      });
      return row;
    });
  }, [months, selected, ratioByRegion]);

  const ratioRanking = useMemo(() => {
    return selected.map((code) => {
      const series = ratioByRegion[code] || [];
      const withData = series.filter((p) => p.ratio != null);
      const last = withData[withData.length - 1];
      return {
        code, name: labelFor(code),
        avgSale: last?.avgSale ?? null, avgJeonse: last?.avgJeonse ?? null, ratio: last?.ratio ?? null,
      };
    }).sort((a, b) => (b.ratio ?? -Infinity) - (a.ratio ?? -Infinity));
  }, [selected, ratioByRegion]);

  const ratioKpis = useMemo(() => {
    const withRatio = ratioRanking.filter((r) => r.ratio != null);
    const avg = withRatio.length ? withRatio.reduce((s, r) => s + r.ratio, 0) / withRatio.length : null;
    const highest = withRatio[0];
    const lowest = withRatio[withRatio.length - 1];
    return { avg, highest, lowest };
  }, [ratioRanking]);

  const unitLabel = isRent ? '전세보증금 평당가' : '매매가 평당가';

  const mapValueFor = (code) => {
    if (isRone) return roneRanking.find((r) => r.code === code)?.latest ?? null;
    if (isRatio) return ratioRanking.find((r) => r.code === code)?.ratio ?? null;
    if (mapColorMode === 'volume') {
      let count = 0;
      months.forEach((ym) => { count += (rawByRegionMonth[`${code}_${ym}`] || []).length; });
      return count || null;
    }
    const targetMonth = timelineMonth || months[months.length - 1];
    const items = rawByRegionMonth[`${code}_${targetMonth}`] || [];
    const valid = items.map((r) => r.pricePerPyeong).filter(Boolean);
    return valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
  };

  const [mapColorMode, setMapColorMode] = useState('price'); // 'price' | 'volume'
  const [dongLayerOn, setDongLayerOn] = useState(true);
  const [ladderBaseline, setLadderBaseline] = useState(null);
  const [timelineMonth, setTimelineMonth] = useState(null); // null = 최신, 아니면 특정 'YYYYMM'
  const [tradeUpCurrentPrice, setTradeUpCurrentPrice] = useState('');
  const [tradeUpLoanBalance, setTradeUpLoanBalance] = useState('');
  const [tradeUpTargetPrice, setTradeUpTargetPrice] = useState('');
  const [sidebarDrillSido, setSidebarDrillSido] = useState(null);
  const [regionSearch, setRegionSearch] = useState('');
  const [focusLatLng, setFocusLatLng] = useState(null);

  const codeToLatLng = useMemo(() => {
    if (!mapFeatures) return {};
    const map = {};
    mapFeatures.forEach((f) => {
      const geomType = f.feature.geometry.type;
      const ring = geomType === 'Polygon'
        ? f.feature.geometry.coordinates[0]
        : f.feature.geometry.coordinates[0][0];
      let sx = 0;
      let sy = 0;
      ring.forEach(([x, y]) => { sx += x; sy += y; });
      const lat = sy / ring.length;
      const lng = sx / ring.length;
      (f.codes || []).forEach((c) => { map[c] = { lat, lng }; });
    });
    return map;
  }, [mapFeatures]);


  const mapDisplayFeatures = useMemo(() => {
    if (!mapFeatures) return null;
    return mapFeatures.map((f) => ({ feature: f.feature, name: f.name, code: (f.codes && f.codes[0]) || undefined, codes: f.codes || [] }));
  }, [mapFeatures]);

  const mapValues = useMemo(() => {
    if (!mapDisplayFeatures) return null;
    return mapDisplayFeatures.map((f) => {
      const codes = f.codes || [];
      const activeCodes = codes.filter((c) => selected.includes(c));
      const candidateCodes = activeCodes.length ? activeCodes : codes;
      const vals = candidateCodes.map((c) => mapValueFor(c)).filter((v) => v != null);
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapDisplayFeatures, selected, rawByRegionMonth, months, roneRanking, ratioRanking, dealType, mapColorMode, timelineMonth]);

  const seoulMapData = useMemo(() => {
    if (!mapDisplayFeatures || !mapValues) return null;
    const available = mapValues.filter((v) => v != null);
    const min = available.length ? Math.min(...available) : 0;
    const max = available.length ? Math.max(...available) : 1;
    return { features: mapDisplayFeatures, values: mapValues, min, max };
  }, [mapDisplayFeatures, mapValues]);

  // "동" 단위 지도 데이터 — 선택된 지역이 속한 시/도만 필요할 때 받아온다.
  const [mapZoomTier, setMapZoomTier] = useState('far');
  const [mapPanelMinimized, setMapPanelMinimized] = useState(false);
  const loadedSidosRef = useRef(new Set());

  useEffect(() => {
    // 확대를 많이 안 하면(구 단위로만 보고 있으면) "동" 데이터는 아예 필요 없으므로,
    // 실제로 확대했을 때만 받아온다 — 안 그러면 지역 선택할 때마다 큰 파일을 미리 받아와서 느려진다.
    // "동 색칠 끄기"가 켜져 있으면 아예 받아오지도 않는다.
    if (!dongLayerOn || mapZoomTier === 'far') return undefined;
    const neededSidos = new Set();
    selected.forEach((code) => {
      for (const g of REGION_GROUPS) {
        if (g.items.some((it) => it.code === code) || (SIDO_AGGREGATES.find((a) => a.code === code)?.sido === g.sido)) {
          neededSidos.add(g.sido);
        }
      }
    });
    const toLoad = [...neededSidos].filter((s) => !loadedSidosRef.current.has(s));
    if (toLoad.length === 0) return undefined;
    let cancelled = false;
    Promise.all(toLoad.map(async (sido) => {
      const feats = await fetchDongGeoForSido(sido);
      loadedSidosRef.current.add(sido);
      const group = REGION_GROUPS.find((g) => g.sido === sido);
      return feats.map((f) => {
        const parts = (f.properties.adm_nm || '').trim().split(/\s+/);
        const dongName = parts[parts.length - 1];
        const guName = parts.slice(1, -1).join(' ');
        let code;
        if (group) {
          if (parts.length === 2) {
            // 세종처럼 구가 없는 경우: 시/도 자체가 바로 상위 지역
            code = group.items[0]?.code;
          } else {
            code = group.items.find((it) => it.name === guName)?.code;
          }
        }
        return { feature: f, name: dongName, regionCode: code };
      }).filter((f) => f.regionCode);
    })).then((results) => {
      if (cancelled) return;
      setDongRawFeatures((prev) => [...prev, ...results.flat()]);
    });
    return () => { cancelled = true; };
  }, [selected, mapZoomTier, dongLayerOn]);

  // 동별 가격/거래량 집계는 지도를 그릴 때마다 allTx를 반복 filter하지 않도록
  // 최초 1회 인덱스로 만들어둔다. 기존 O(동 수 × 거래건수) 구조를
  // O(거래건수 + 동 수)로 줄여서, 동이 많은 지역을 확대할 때 계산량을 크게 줄인다.
  const dongPriceIndex = useMemo(() => {
    const index = new Map();
    const guIndex = new Map();
    if (!dongLayerOn) { index.guFallback = guIndex; return index; }
    allTx.forEach((t) => {
      if (!t?.regionCode || !t?.dong) return;
      const value = isRent ? (t.isJeonse ? t.depositPerPyeong : null) : t.pricePerPyeong;
      const key = `${t.regionCode}|${normalizeDongName(t.dong)}`;
      const prev = index.get(key);
      if (prev) {
        prev.count += 1;
        if (value != null) { prev.sum += value; prev.priced += 1; }
      } else {
        index.set(key, { sum: value ?? 0, priced: value != null ? 1 : 0, count: 1 });
      }
      const guPrev = guIndex.get(t.regionCode);
      if (guPrev) {
        guPrev.count += 1;
        if (value != null) { guPrev.sum += value; guPrev.priced += 1; }
      } else {
        guIndex.set(t.regionCode, { sum: value ?? 0, priced: value != null ? 1 : 0, count: 1 });
      }
    });
    index.guFallback = guIndex;
    return index;
  }, [allTx, isRent, dongLayerOn]);

  const dongMapData = useMemo(() => {
    if (!dongLayerOn || dongRawFeatures.length === 0) return null;
    // 이미 선택된 지역의 동만 보여주면, 아직 선택 안 한 옆 동네는 지도에 동 도형 자체가 없어서
    // 클릭해도 반응이 없는 것처럼 보인다. 그래서 이미 불러온 시/도 전체의 동을 다 그리되,
    // 실거래 데이터가 있는(=이미 선택된) 동만 색이 들어가고 나머지는 연한 무채색으로 그린다 —
    // 어느 동이든 눌러서 그 구를 새로 선택할 수 있게 한다.
    const values = dongRawFeatures.map((f) => {
      if (isRatio) {
        // 전세가율은 동 단위로 따로 계산하지 않으므로, 구 전체 전세가율 값을 그대로 쓴다.
        return ratioRanking.find((r) => r.code === f.regionCode)?.ratio ?? null;
      }
      const agg = dongPriceIndex.get(`${f.regionCode}|${normalizeDongName(f.name)}`);
      if (mapColorMode === 'volume') {
        if (agg?.count) return agg.count;
        return null; // 거래량은 없으면 0이 맞는 값이라 구 평균으로 대체하면 오히려 왜곡된다.
      }
      if (agg?.priced) return agg.sum / agg.priced;
      // 이 동 자체엔 실거래가 없어도, 같은 구 안에 데이터가 있으면 구 전체 평균으로 채운다 —
      // 네이버 지도처럼 구 전체가 한 색으로 일관되게 보이도록.
      const guAgg = dongPriceIndex.guFallback?.get(f.regionCode);
      return guAgg?.priced ? guAgg.sum / guAgg.priced : null;
    });
    const available = values.filter((v) => v != null);
    const min = available.length ? Math.min(...available) : 0;
    const max = available.length ? Math.max(...available) : 1;
    return {
      features: dongRawFeatures.map((f) => ({ feature: f.feature, name: f.name, code: f.regionCode })),
      values,
      min,
      max,
    };
  }, [dongRawFeatures, dongPriceIndex, mapColorMode, dongLayerOn, isRatio, ratioRanking]);


  const styles = {
    page: {
      background: PALETTE.bg, color: PALETTE.textPrimary,
      fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Noto Sans KR', system-ui, sans-serif",
      minHeight: '100vh',
    },
    sidebar: {
      background: PALETTE.panel, borderRight: `1px solid ${PALETTE.border}`,
      padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 20,
    },
    main: { padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 24 },
    label: { fontSize: 12, color: PALETTE.textSecondary, marginBottom: 6, display: 'block' },
    select: {
      width: '100%', background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`,
      borderRadius: 10, padding: '8px 10px', color: PALETTE.textPrimary, fontSize: 13,
      transition: 'border-color 0.15s ease',
    },
    btn: {
      background: PALETTE.accent, color: ACCENT_TEXT, border: 'none', borderRadius: 10,
      padding: '10px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%',
      transition: 'transform 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease',
      boxShadow: '0 2px 6px rgba(178,58,46,0.25)',
    },
    toggleBtn: (active) => ({
      flex: 1, textAlign: 'center', padding: '8px 0', borderRadius: 10, fontSize: 13, cursor: 'pointer',
      border: `1px solid ${active ? PALETTE.accent : PALETTE.border}`,
      background: active ? 'rgba(178,58,46,0.10)' : 'transparent',
      color: active ? PALETTE.up : PALETTE.textSecondary,
      transition: 'all 0.15s ease',
    }),
    chip: {
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 16,
      border: `1px solid ${PALETTE.accent}`, background: 'rgba(178,58,46,0.10)',
      color: PALETTE.up, fontSize: 12, transition: 'all 0.15s ease',
    },
    card: {
      background: PALETTE.panel, border: `1px solid ${PALETTE.border}`, borderRadius: 14, padding: '16px 18px',
      boxShadow: '0 1px 3px rgba(33,31,26,0.04)', transition: 'box-shadow 0.2s ease, transform 0.2s ease',
      animation: 'fadeInUp 0.35s ease both',
    },
    kpiLabel: { fontSize: 12, color: PALETTE.textMuted, marginBottom: 6 },
    kpiValue: { fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' },
    sectionTitle: { fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', margin: '0 0 12px' },
    th: { textAlign: 'left', fontSize: 11, color: PALETTE.textMuted, fontWeight: 500, padding: '6px 10px', borderBottom: `1px solid ${PALETTE.border}`, whiteSpace: 'nowrap' },
    td: { fontSize: 13, padding: '8px 10px', borderBottom: `1px solid ${PALETTE.border}`, color: PALETTE.textPrimary, whiteSpace: 'nowrap' },
  };

  const sidebarInner = (
    <>
        <div>
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Building2 size={18} color={PALETTE.accent} />
              <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em' }}>
                아파트 실거래가 대시보드
              </span>
            </div>
            <ChevronLeft
              size={18}
              color={PALETTE.textMuted}
              style={{ cursor: 'pointer', flexShrink: 0 }}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={() => setPanelOpen(false)}
            />
          </div>
          <p style={{ fontSize: 11.5, color: PALETTE.textMuted, lineHeight: 1.5, margin: 0 }}>
            국토교통부 실거래 공개자료 기반. 접속할 때마다 서버가 최신 데이터를 가져옵니다.
          </p>
        </div>

        <div>
          <label style={styles.label}>거래 유형</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            <div style={styles.toggleBtn(dealType === 'trade')} onClick={() => setDealTypeSafe('trade')}>매매</div>
            <div style={styles.toggleBtn(dealType === 'rent')} onClick={() => setDealTypeSafe('rent')}>전월세</div>
            <div style={styles.toggleBtn(dealType === 'silv')} onClick={() => setDealTypeSafe('silv')}>분양권전매</div>
            <div style={styles.toggleBtn(dealType === 'rone')} onClick={() => setDealTypeSafe('rone')}>시세동향</div>
            <div style={styles.toggleBtn(dealType === 'ratio')} onClick={() => setDealTypeSafe('ratio')}>전세가율</div>
          </div>
          {isRone && (
            <p style={{ fontSize: 10.5, color: PALETTE.textMuted, marginTop: 6 }}>
              한국부동산원 전국주택가격동향조사 기준 (실거래와 별도 통계, 표본조사)
            </p>
          )}
        </div>

        {!isRone && !isSilv && (
        <div>
          <label style={styles.label}>매물 종류</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            <div style={styles.toggleBtn(propertyType === 'apt')} onClick={() => setPropertyType('apt')}>아파트</div>
            <div style={styles.toggleBtn(propertyType === 'offi')} onClick={() => setPropertyType('offi')}>오피스텔</div>
          </div>
        </div>
        )}

        {!isRone && !isRatio && (
        <div>
          <label style={styles.label}>평형 (전용면적 기준)</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))', gap: 6 }}>
            {[['all', '전체'], ['u20', '20평 미만'], ['20s', '20평대'], ['30s', '30평대'], ['40s', '40평대'], ['50p', '50평 이상']].map(([k, l]) => (
              <div key={k} style={{ ...styles.toggleBtn(unitSizeFilter === k), padding: '7px 2px', fontSize: 11.5 }} onClick={() => setUnitSizeFilter(k)}>{l}</div>
            ))}
          </div>
          <p style={{ fontSize: 10, color: PALETTE.textMuted, margin: '6px 0 4px' }}>정확한 전용면적으로 비교 (±2㎡)</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(60px, 1fr))', gap: 6 }}>
            {[['sqm59', '59㎡'], ['sqm74', '74㎡'], ['sqm84', '84㎡'], ['sqm101', '101㎡']].map(([k, l]) => (
              <div key={k} style={{ ...styles.toggleBtn(unitSizeFilter === k), padding: '7px 2px', fontSize: 11.5 }} onClick={() => setUnitSizeFilter(unitSizeFilter === k ? 'all' : k)}>{l}</div>
            ))}
          </div>
        </div>
        )}

        {(dealType === 'trade' || isSilv) && (
        <div>
          <label style={styles.label}>입주년차 (준공연도 기준)</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))', gap: 6 }}>
            {[['all', '전체'], ['5', '5년 이내'], ['10', '10년 이내'], ['15', '15년 이내'], ['20', '20년 이내'], ['20p', '20년 초과']].map(([k, l]) => (
              <div key={k} style={{ ...styles.toggleBtn(buildYearFilter === k), padding: '7px 2px', fontSize: 11.5 }} onClick={() => setBuildYearFilter(k)}>{l}</div>
            ))}
          </div>
        </div>
        )}

        <div>
          <label style={styles.label}>조회 기간</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 10 }}>
            {[1, 3, 6, 12].map((n) => (
              <div
                key={n}
                onClick={() => { setEndYm(ymNow()); setStartYm(ymShift(ymNow(), -(n - 1))); }}
                style={{ ...styles.toggleBtn(startYm === ymShift(ymNow(), -(n - 1)) && endYm === ymNow()), padding: '7px 0', fontSize: 12 }}
              >
                최근 {n}개월
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 11, color: PALETTE.textMuted, width: 28 }}>부터</span>
              <select
                value={startYm.slice(0, 4)}
                onChange={(e) => setStartYm(`${e.target.value}${startYm.slice(4, 6)}`)}
                style={{ ...styles.select, padding: '6px 4px', fontSize: 12, flex: 1 }}
              >
                {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}년</option>)}
              </select>
              <select
                value={startYm.slice(4, 6)}
                onChange={(e) => setStartYm(`${startYm.slice(0, 4)}${e.target.value}`)}
                style={{ ...styles.select, padding: '6px 4px', fontSize: 12, flex: 1 }}
              >
                {MONTH_OPTIONS.map((m) => <option key={m} value={m}>{parseInt(m, 10)}월</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 11, color: PALETTE.textMuted, width: 28 }}>까지</span>
              <select
                value={endYm.slice(0, 4)}
                onChange={(e) => setEndYm(`${e.target.value}${endYm.slice(4, 6)}`)}
                style={{ ...styles.select, padding: '6px 4px', fontSize: 12, flex: 1 }}
              >
                {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}년</option>)}
              </select>
              <select
                value={endYm.slice(4, 6)}
                onChange={(e) => setEndYm(`${endYm.slice(0, 4)}${e.target.value}`)}
                style={{ ...styles.select, padding: '6px 4px', fontSize: 12, flex: 1 }}
              >
                {MONTH_OPTIONS.map((m) => <option key={m} value={m}>{parseInt(m, 10)}월</option>)}
              </select>
            </div>
          </div>
        </div>

        {dongFilterOptions.length > 0 && (
        <div>
          <label style={styles.label}>동 필터</label>
          <select
            value={dongFilter}
            onChange={(e) => setDongFilter(e.target.value)}
            style={{ ...styles.select, fontSize: 13 }}
          >
            <option value="all">전체 동</option>
            {dongFilterOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <p style={{ fontSize: 10.5, color: PALETTE.textMuted, margin: '4px 0 0' }}>
            선택하면 대시보드·비교·지도 전체가 그 동 기준으로 좁혀져요.
          </p>
        </div>
        )}

        <div>
          <label style={styles.label}>지역 선택</label>
          <input
            type="text"
            placeholder="지역명 검색 (예: 강남, 분당)"
            value={regionSearch}
            onChange={(e) => setRegionSearch(e.target.value)}
            style={{ ...styles.select, marginBottom: 8 }}
          />

          {!sidebarDrillSido ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {REGION_GROUPS
                .filter((g) => !regionSearch || g.sido.includes(regionSearch))
                .map((g) => (
                  <div
                    key={g.sido}
                    onClick={() => setSidebarDrillSido(g.sido)}
                    style={{ ...styles.toggleBtn(false), padding: '8px 2px', fontSize: 12.5 }}
                  >
                    {g.sido.replace(/특별자치시|특별자치도|광역시|특별시|도$/, '')}
                  </div>
                ))}
              {isRone && RONE_ONLY_EXTRA.map((it) => (
                <div
                  key={it.code}
                  onClick={() => addRegionAndFetch(it.code)}
                  style={{ ...styles.toggleBtn(selected.includes(it.code)), padding: '8px 2px', fontSize: 11.5 }}
                >
                  {it.name}
                </div>
              ))}
            </div>
          ) : (
            <>
              <div
                onClick={() => setSidebarDrillSido(null)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', marginBottom: 8 }}
              >
                <ChevronLeft size={14} color={PALETTE.textSecondary} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>{sidebarDrillSido}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                {(() => {
                  const agg = SIDO_AGGREGATES.find((a) => a.sido === sidebarDrillSido);
                  return agg && (!regionSearch || agg.name.includes(regionSearch)) ? (
                    <div
                      key={agg.code}
                      onClick={() => addRegionAndFetch(agg.code)}
                      style={{
                        ...styles.toggleBtn(selected.includes(agg.code)), padding: '7px 2px', fontSize: 11.5, fontWeight: 700,
                      }}
                    >
                      {agg.name}
                    </div>
                  ) : null;
                })()}
                {(REGION_GROUPS.find((g) => g.sido === sidebarDrillSido)?.items || [])
                  .filter((it) => !regionSearch || it.name.includes(regionSearch))
                  .map((it) => (
                    <div
                      key={it.code}
                      onClick={() => addRegionAndFetch(it.code)}
                      style={{ ...styles.toggleBtn(selected.includes(it.code)), padding: '7px 2px', fontSize: 11.5 }}
                    >
                      {it.name}
                    </div>
                  ))}
              </div>
            </>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, maxHeight: 140, overflowY: 'auto' }}>
            {selected.map((code) => (
              <span key={code} style={styles.chip}>
                {labelFor(code)}
                <X size={11} style={{ cursor: 'pointer' }} onClick={() => removeRegion(code)} />
              </span>
            ))}
            {selected.length === 0 && (
              <span style={{ fontSize: 12, color: PALETTE.textMuted }}>선택된 지역이 없습니다.</span>
            )}
          </div>
          {!isRone && selected.some(isSidoAggregate) && (
            <p style={{ fontSize: 10.5, color: PALETTE.textMuted, marginTop: 6 }}>
              시/도 전체는 그 안의 모든 시/군/구를 합산하는 방식이라 조회가 더 오래 걸려요.
              기간은 3~6개월 정도로 시작해보세요.
            </p>
          )}
        </div>

        <div>
          <label style={styles.label}>단지 검색 (현재 조회 내역)</label>
          <input
            type="text"
            placeholder="아파트 이름 입력 (예: 자이, 푸르지오)"
            value={complexSearch}
            onChange={(e) => setComplexSearch(e.target.value)}
            style={styles.select}
          />
          {complexSearch.trim() && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
              {complexSearchResults.slice(0, 8).map((c) => (
                <div
                  key={c.key}
                  onClick={() => {
                    setComplexSearch('');
                    const coord = codeToLatLng[c.regionCode];
                    setSelectedApt({ apt: c.apt, dong: c.dong, regionCode: c.regionCode, lat: coord?.lat, lng: coord?.lng });
                  }}
                  style={{
                    border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: '7px 9px', cursor: 'pointer',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.apt}</div>
                    <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>{regionLabel(c.regionCode)} {c.dong}</div>
                  </div>
                  <span style={{ fontSize: 10.5, color: PALETTE.textMuted, flexShrink: 0 }}>단지 상세</span>
                </div>
              ))}
              {complexSearchResults.length === 0 && (
                <span style={{ fontSize: 11.5, color: PALETTE.textMuted }}>일치하는 단지가 없어요.</span>
              )}
            </div>
          )}
        </div>

        <div>
          <label style={styles.label}>즐겨찾기</label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <input
              style={styles.select}
              placeholder="이름 (예: 우리동네)"
              value={favName}
              onChange={(e) => setFavName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveFavorite(); }}
            />
            <button onClick={saveFavorite} className="ui-btn" style={{ ...styles.btn, width: 68, padding: 0 }}>저장</button>
          </div>
          {favorites.length === 0 ? (
            <p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: 0 }}>
              현재 거래유형·기간·지역 조합을 이름 붙여 저장해두면 다음에 바로 불러올 수 있어요.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {favorites.map((fav) => (
                <div key={fav.name} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  border: `1px solid ${PALETTE.border}`, borderRadius: 10, padding: '6px 8px',
                }}>
                  <span
                    style={{ fontSize: 12.5, cursor: 'pointer', color: PALETTE.textPrimary }}
                    onClick={() => applyFavorite(fav)}
                  >
                    {fav.name}
                  </span>
                  <X size={12} style={{ cursor: 'pointer', color: PALETTE.textMuted }} onClick={() => removeFavorite(fav.name)} />
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          className="ui-btn"
          style={{
            ...styles.btn, position: 'sticky', bottom: 0, boxShadow: '0 -8px 12px -4px rgba(255,255,255,0.9)',
          }}
          onClick={() => handleFetch()}
          disabled={status === 'loading'}
        >
          <RefreshCw size={14} className={status === 'loading' ? 'spin' : ''} />
          {status === 'loading' ? '조회 중...' : '데이터 조회'}
        </button>

        {errorMsg && (
          <div style={{
            display: 'flex', gap: 8, fontSize: 12, color: PALETTE.down,
            background: 'rgba(239,68,68,0.08)', border: `1px solid ${PALETTE.accent}`, borderRadius: 10, padding: 10,
          }}>
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{errorMsg}</span>
          </div>
        )}
    </>
  );

  return (
    <div style={styles.page}>
      <div className="no-print" style={{
        position: 'sticky', top: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', gap: 18,
        padding: '0 16px', height: 58, background: '#1A1A1A',
        boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <Building2 size={20} color={PALETTE.accent} />
          <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em', color: '#fff' }}>도갱노노</span>
        </div>
        <nav style={{ display: 'flex', gap: 2, height: '100%', flex: 1, minWidth: 0 }} className="main-nav">
          {[
            { key: 'normal', label: '대시보드' },
            { key: 'map', label: '지도' },
            { key: 'compare', label: '비교분석' },
            { key: 'subscriptions', label: '분양정보' },
            { key: 'analytics', label: '순위·통계' },
            { key: 'market', label: '시장분석' },
            { key: 'favorites', label: '즐겨찾기' },
          ].map((t) => (
            <div
              key={t.key}
              onClick={() => setViewMode(t.key)}
              style={{
                display: 'flex', alignItems: 'center', height: '100%', padding: '0 7px', cursor: 'pointer',
                fontSize: 12.5, fontWeight: viewMode === t.key ? 700 : 500, whiteSpace: 'nowrap',
                color: viewMode === t.key ? '#fff' : 'rgba(255,255,255,0.55)',
                borderBottom: viewMode === t.key ? `2px solid ${PALETTE.accent}` : '2px solid transparent',
                transition: 'color 0.15s ease, border-color 0.15s ease',
              }}
            >
              {t.label}
            </div>
          ))}
        </nav>
        <div className="header-search" style={{ marginLeft: 'auto', position: 'relative', flexShrink: 0 }}>
          <input
            type="text"
            value={globalSearch}
            onChange={(e) => { setGlobalSearch(e.target.value); setGlobalSearchMsg(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleGlobalSearch(); }}
            placeholder="지역 또는 단지명 검색"
            style={{
              width: 128, padding: '7px 9px', borderRadius: 8, border: 'none', outline: 'none',
              background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 12.5,
            }}
          />
          {globalSearchMsg && (
            <div style={{
              position: 'absolute', top: '110%', right: 0, background: PALETTE.panel, color: PALETTE.textPrimary,
              border: `1px solid ${PALETTE.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 11.5,
              whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 300,
            }}>
              {globalSearchMsg}
            </div>
          )}
        </div>
      </div>

      {viewMode === 'map' ? (
        <MapTab
          selectedApt={selectedApt}
          panelOpen={panelOpen} setPanelOpen={setPanelOpen} sidebarInner={sidebarInner} styles={styles}
          mapError={mapError} seoulMapData={seoulMapData} addRegionAndFetch={addRegionAndFetch} focusLatLng={focusLatLng}
          mapFocusMatches={mapFocusMatches} budgetMatches={budgetMatches} priceMoveMatches={priceMoveMatches}
          mapComplexes={mapComplexes}
          setSelectedApt={setSelectedApt} dongMapData={dongMapData} setMapZoomTier={setMapZoomTier}
          setMapViewportBounds={setMapViewportBounds} setVisibleMarkerCount={setVisibleMarkerCount}
          visibleStations={visibleStations}
          dealType={dealType} setDealTypeSafe={setDealTypeSafe} isRone={isRone} isRatio={isRatio} isRent={isRent}
          mapColorMode={mapColorMode} setMapColorMode={setMapColorMode}
          budgetSearchOpen={budgetSearchOpen} setBudgetSearchOpen={setBudgetSearchOpen}
          budgetAmount={budgetAmount} setBudgetAmount={setBudgetAmount}
          dongLayerOn={dongLayerOn} setDongLayerOn={setDongLayerOn}
          subwayLayerOn={subwayLayerOn} setSubwayLayerOn={setSubwayLayerOn}
          priceMoveFilter={priceMoveFilter} setPriceMoveFilter={setPriceMoveFilter}
          setMapFocusKeys={setMapFocusKeys}
          selected={selected} allTx={allTx} visibleMarkerCount={visibleMarkerCount}
          months={months} timelineMonth={timelineMonth} setTimelineMonth={setTimelineMonth}
          mapPanelMinimized={mapPanelMinimized} setMapPanelMinimized={setMapPanelMinimized}
          mapViewportBounds={mapViewportBounds} mapPanelList={mapPanelList}
          mapComplexCoordByKey={mapComplexCoordByKey} codeToLatLng={codeToLatLng} setFocusLatLng={setFocusLatLng}
        />
      ) : viewMode === 'compare' ? (
        <CompareTab
          pinnedComplexes={pinnedComplexes} setPinnedComplexes={setPinnedComplexes}
          complexCompare={complexCompare} setSelectedApt={setSelectedApt} isRent={isRent}
          comparePickerValue={comparePickerValue} addRegionAndFetch={addRegionAndFetch} status={status}
          compareAKey={compareAKey} setCompareAKey={setCompareAKey}
          compareBKey={compareBKey} setCompareBKey={setCompareBKey}
          compareCKey={compareCKey} setCompareCKey={setCompareCKey}
          compareOptions={compareOptions} compareAResult={compareAResult} compareBResult={compareBResult} compareCResult={compareCResult}
          compareChartData={compareChartData} compareBarData={compareBarData} compareResultsList={compareResultsList}
          styles={styles}
        />
      ) : viewMode === 'subscriptions' ? (
        <SubscriptionsTab
          subsTabSido={subsTabSido} setSubsTabSido={setSubsTabSido}
          subsSubView={subsSubView} setSubsSubView={setSubsSubView}
          subsTabLoading={subsTabLoading} subsTabRows={subsTabRows} supplyByMonth={supplyByMonth}
          styles={styles}
        />
      ) : viewMode === 'analytics' ? (
        <AnalyticsTab
          comparePickerValue={comparePickerValue} addRegionAndFetch={addRegionAndFetch}
          selected={selected} removeRegion={removeRegion} status={status}
          analyticsKpis={analyticsKpis} unitLabel={unitLabel}
          analyticsScope={analyticsScope} setAnalyticsScope={setAnalyticsScope}
          analyticsMetric={analyticsMetric} setAnalyticsMetric={setAnalyticsMetric}
          analyticsSorted={analyticsSorted} setSelectedApt={setSelectedApt}
          complexCompare={complexCompare} ladderBaseline={ladderBaseline} setLadderBaseline={setLadderBaseline}
          styles={styles}
        />
      ) : viewMode === 'market' ? (
        <MarketTab
          comparePickerValue={comparePickerValue} addRegionAndFetch={addRegionAndFetch}
          selected={selected} removeRegion={removeRegion} status={status}
          analyticsPeriod={analyticsPeriod} setAnalyticsPeriod={setAnalyticsPeriod} advancedAnalytics={advancedAnalytics}
          analyticsView={analyticsView} setAnalyticsView={setAnalyticsView}
          marketIntensity={marketIntensity} ratioKpis={ratioKpis}
          setSelectedApt={setSelectedApt} marketSignals={marketSignals}
          styles={styles}
        />
      ) : viewMode === 'favorites' ? (
        <FavoritesTab
          favorites={favorites} applyFavorite={applyFavorite} setViewMode={setViewMode} removeFavorite={removeFavorite}
          userAlerts={userAlerts} complexCompare={complexCompare} setSelectedApt={setSelectedApt} isRent={isRent}
          removeUserAlert={removeUserAlert} addRegionAndFetch={addRegionAndFetch}
          listingForm={listingForm} setListingForm={setListingForm} addListing={addListing}
          myListingsWithComparison={myListingsWithComparison} updateListingStatus={updateListingStatus} removeListing={removeListing}
          pinnedComplexes={pinnedComplexes} setPinnedComplexes={setPinnedComplexes}
          visitForm={visitForm} setVisitForm={setVisitForm} addVisit={addVisit} myVisits={myVisits} removeVisit={removeVisit}
          scenario={scenario} setScenario={setScenario} myListings={myListings}
          styles={styles}
        />
      ) : (
      <div style={{ padding: '20px 20px 0' }}>
        {panelOpen ? (
        <aside
          style={{
            ...styles.sidebar, maxWidth: 420, borderRadius: 16,
            border: `1px solid ${PALETTE.border}`, borderRight: `1px solid ${PALETTE.border}`,
          }}
          className="dash-sidebar-static"
        >
          {sidebarInner}
        </aside>
        ) : (
        <button
          onClick={() => setPanelOpen(true)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, background: PALETTE.panel,
            border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: '8px 14px',
            cursor: 'pointer', fontSize: 13, color: PALETTE.textPrimary,
          }}
        >
          <ChevronRight size={16} /> 조건 패널 펼치기
        </button>
        )}
      </div>
      )}

      {viewMode !== 'compare' && viewMode !== 'subscriptions' && viewMode !== 'favorites' && viewMode !== 'analytics' && viewMode !== 'market' && (
      <main style={styles.main} className="dash-main">
        <div>
          <h1 className="dash-title" style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 4px' }}>
            선택 지역 아파트 {isRatio ? '전세가율' : isRone ? '시세동향' : isSilv ? '분양권전매' : isRent ? '전월세' : '매매'} 시황
          </h1>
          <p style={{ fontSize: 12.5, color: PALETTE.textMuted, margin: 0 }}>
            {fetchedAt
              ? `${fetchedAt.toLocaleString('ko-KR')} 기준 · 실거래 신고 특성상 최근 1~2개월 데이터는 계속 채워지는 중일 수 있습니다.`
              : '왼쪽에서 조건을 설정한 뒤 데이터 조회를 눌러주세요.'}
          </p>
        </div>

        {populationLoading && populationRows.length === 0 && (
          <div style={{ ...styles.card, fontSize: 12, color: PALETTE.textMuted }} className="ui-card">
            인구 추이 불러오는 중...
          </div>
        )}
        {populationRows.length > 1 && (() => {
          const first = populationRows[0];
          const last = populationRows[populationRows.length - 1];
          const change = first.population ? ((last.population - first.population) / first.population) * 100 : null;
          const chartData = populationRows.map((r) => ({
            ym: `${r.ym.slice(0, 4)}.${r.ym.slice(4, 6)}`,
            인구: r.population,
          }));
          return (
            <div style={styles.card} className="ui-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <h2 style={{ ...styles.sectionTitle, marginBottom: 4 }}>{currentSidoShort} 인구 추이 (KOSIS)</h2>
                  <p style={{ fontSize: 11, color: PALETTE.textMuted, margin: 0 }}>
                    최근 {populationRows.length}개월, 주민등록인구 기준
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>{last.population.toLocaleString()}명</div>
                  <div style={{ fontSize: 12, color: change > 0 ? PALETTE.up : change < 0 ? PALETTE.down : PALETTE.textSecondary }}>
                    {change > 0 ? '▲' : change < 0 ? '▼' : ''} {fmtPct(change)} ({populationRows.length}개월 전 대비)
                  </div>
                </div>
              </div>
              <div style={{ width: '100%', height: 160, marginTop: 12 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={PALETTE.border} vertical={false} />
                    <XAxis dataKey="ym" stroke={PALETTE.textMuted} fontSize={10} tickLine={false} />
                    <YAxis stroke={PALETTE.textMuted} fontSize={10} tickLine={false} width={56}
                      tickFormatter={(v) => v.toLocaleString()} domain={['auto', 'auto']} />
                    <Tooltip contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                      labelStyle={{ color: PALETTE.textPrimary }}
                      formatter={(v) => `${v.toLocaleString()}명`} />
                    <Line type="monotone" dataKey="인구" stroke={PALETTE.down} strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })()}

        {migrationLoading && migrationRows.length === 0 && (
          <div style={{ ...styles.card, fontSize: 12, color: PALETTE.textMuted }} className="ui-card">
            인구이동 추이 불러오는 중...
          </div>
        )}
        {migrationRows.length > 1 && (() => {
          const byItem = {};
          migrationRows.forEach((r) => { (byItem[r.itmName] ||= []).push(r); });
          const itemNames = Object.keys(byItem);
          const months = [...new Set(migrationRows.map((r) => r.ym))].sort();
          const chartData = months.map((ym) => {
            const row = { ym: `${ym.slice(0, 4)}.${ym.slice(4, 6)}` };
            itemNames.forEach((name) => {
              const hit = byItem[name].find((r) => r.ym === ym);
              if (hit) row[name] = hit.value;
            });
            return row;
          });
          return (
            <div style={styles.card} className="ui-card">
              <h2 style={{ ...styles.sectionTitle, marginBottom: 4 }}>{currentSidoShort} 인구이동 추이 (KOSIS)</h2>
              <p style={{ fontSize: 11, color: PALETTE.textMuted, margin: '0 0 8px' }}>
                국가데이터처 국내인구이동통계 기준, 최근 {months.length}개월
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                {itemNames.map((name, i) => {
                  const last = byItem[name][byItem[name].length - 1];
                  return (
                    <span key={name} style={{ ...styles.chip, color: LINE_COLORS[i % LINE_COLORS.length], borderColor: LINE_COLORS[i % LINE_COLORS.length] }}>
                      {name} {last?.value?.toLocaleString()}명
                    </span>
                  );
                })}
              </div>
              <div style={{ width: '100%', height: 180 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={PALETTE.border} vertical={false} />
                    <XAxis dataKey="ym" stroke={PALETTE.textMuted} fontSize={10} tickLine={false} />
                    <YAxis stroke={PALETTE.textMuted} fontSize={10} tickLine={false} width={56}
                      tickFormatter={(v) => v.toLocaleString()} domain={['auto', 'auto']} />
                    <Tooltip contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                      labelStyle={{ color: PALETTE.textPrimary }}
                      formatter={(v) => `${v?.toLocaleString()}명`} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {itemNames.map((name, i) => (
                      <Line key={name} type="monotone" dataKey={name} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={false} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p style={{ fontSize: 9.5, color: PALETTE.textMuted, margin: '8px 0 0' }}>
                항목명은 통계청 KOSIS가 제공하는 명칭을 그대로 표시했어요.
              </p>
            </div>
          );
        })()}

        {subscriptionsLoading && subscriptions.length === 0 && (
          <div style={{ ...styles.card, fontSize: 12, color: PALETTE.textMuted }} className="ui-card">
            분양(청약) 정보 불러오는 중...
          </div>
        )}
        {subscriptions.length > 0 && (
          <div style={styles.card} className="ui-card">
            <h2 style={styles.sectionTitle}>최근 분양(청약) 정보 · {currentSidoShort}</h2>
            <p style={{ fontSize: 11, color: PALETTE.textMuted, margin: '-6px 0 12px' }}>
              한국부동산원 청약홈 기준, 최근 1년 내 모집공고. 빨간 배지는 투기과열지구/조정대상지역이에요.
            </p>
            <div style={{ maxHeight: 260, overflowY: 'auto', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={styles.th}>주택명</th>
                    <th style={styles.th}>위치</th>
                    <th style={styles.th}>공급규모</th>
                    <th style={styles.th}>모집공고일</th>
                    <th style={styles.th}>청약접수</th>
                    <th style={styles.th}>입주예정</th>
                    <th style={styles.th}>규제</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.map((s, i) => (
                    <tr key={i}>
                      <td style={styles.td}>
                        {s.url ? (
                          <a href={s.url} target="_blank" rel="noreferrer" style={{ color: PALETTE.accent }}>{s.houseName}</a>
                        ) : s.houseName}
                      </td>
                      <td style={styles.td}>{s.address}</td>
                      <td style={styles.td}>{s.totalUnits}세대</td>
                      <td style={styles.td}>{s.announceDate}</td>
                      <td style={styles.td}>{s.receiptStart} ~ {s.receiptEnd}</td>
                      <td style={styles.td}>{s.moveInMonth}</td>
                      <td style={styles.td}>
                        {(s.isSpeculationOverheated || s.isAdjustmentTarget) && (
                          <span style={{ ...styles.chip, padding: '2px 8px', fontSize: 11 }}>규제</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {status === 'done' && isRatio && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              <div style={styles.card} className="ui-card">
                <div style={styles.kpiLabel}>선택 지역 평균 전세가율</div>
                <div style={styles.kpiValue}>{ratioKpis.avg != null ? `${ratioKpis.avg.toFixed(1)}%` : '-'}</div>
              </div>
              <div style={styles.card} className="ui-card">
                <div style={styles.kpiLabel}>전세가율 최고 지역</div>
                <div style={{ ...styles.kpiValue, fontSize: 16 }}>
                  {ratioKpis.highest ? `${ratioKpis.highest.name} ${ratioKpis.highest.ratio.toFixed(1)}%` : '-'}
                </div>
              </div>
              <div style={styles.card} className="ui-card">
                <div style={styles.kpiLabel}>전세가율 최저 지역</div>
                <div style={{ ...styles.kpiValue, fontSize: 16 }}>
                  {ratioKpis.lowest ? `${ratioKpis.lowest.name} ${ratioKpis.lowest.ratio.toFixed(1)}%` : '-'}
                </div>
              </div>
            </div>


            <div style={styles.card} className="ui-card">
              <h2 style={styles.sectionTitle}>전세가율 추이 (%)</h2>
              <p style={{ fontSize: 11, color: PALETTE.textMuted, margin: '-6px 0 12px' }}>
                해당 월 평균 전세보증금 ÷ 평균 매매가 × 100. 면적·평형 보정은 하지 않은 단순 평균 기준입니다.
              </p>
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <LineChart data={ratioChartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={PALETTE.border} vertical={false} />
                    <XAxis dataKey="ym" stroke={PALETTE.textMuted} fontSize={11} tickLine={false} />
                    <YAxis stroke={PALETTE.textMuted} fontSize={11} tickLine={false} width={44} unit="%" />
                    <Tooltip contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                      labelStyle={{ color: PALETTE.textPrimary }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {selected.map((code, i) => (
                      <Line key={code} type="monotone" dataKey={labelFor(code)}
                        stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={styles.card} className="ui-card">
              <h2 style={styles.sectionTitle}>지역별 전세가율 순위</h2>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={styles.th}>지역</th>
                    <th style={styles.th}>매매 평균가</th>
                    <th style={styles.th}>전세 평균가</th>
                    <th style={styles.th}>전세가율</th>
                  </tr>
                </thead>
                <tbody>
                  {ratioRanking.map((r) => (
                    <tr key={r.code}>
                      <td style={styles.td}>{r.name}</td>
                      <td style={styles.td}>{r.avgSale != null ? fmtWon(r.avgSale) : '-'}</td>
                      <td style={styles.td}>{r.avgJeonse != null ? fmtWon(r.avgJeonse) : '-'}</td>
                      <td style={styles.td}>{r.ratio != null ? `${r.ratio.toFixed(1)}%` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </>
        )}

        {status === 'done' && isRone && (
          <>
            {roneUnmapped.length > 0 && (
              <div style={{
                display: 'flex', gap: 8, fontSize: 12, color: PALETTE.down,
                background: 'rgba(239,68,68,0.08)', border: `1px solid ${PALETTE.accent}`, borderRadius: 10, padding: 10,
              }}>
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>이 통계를 아직 지원하지 않는 지역: {roneUnmapped.map(labelFor).join(', ')}</span>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              <div style={styles.card} className="ui-card">
                <div style={styles.kpiLabel}>선택 지역 평균매매가격 평균</div>
                <div style={styles.kpiValue}>
                  {roneKpis.avg != null ? `${Math.round(roneKpis.avg).toLocaleString()}만원` : '-'}
                </div>
              </div>
              <div style={styles.card} className="ui-card">
                <div style={styles.kpiLabel}>기간 내 최고 상승</div>
                <div style={{ ...styles.kpiValue, fontSize: 16, color: PALETTE.up, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <TrendingUp size={15} />
                  {roneKpis.rising ? `${roneKpis.rising.name} ${fmtPct(roneKpis.rising.change)}` : '-'}
                </div>
              </div>
              <div style={styles.card} className="ui-card">
                <div style={styles.kpiLabel}>기간 내 최고 하락</div>
                <div style={{ ...styles.kpiValue, fontSize: 16, color: PALETTE.down, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <TrendingDown size={15} />
                  {roneKpis.falling ? `${roneKpis.falling.name} ${fmtPct(roneKpis.falling.change)}` : '-'}
                </div>
              </div>
            </div>


            <div style={styles.card} className="ui-card">
              <h2 style={styles.sectionTitle}>평균매매가격 추이 (한국부동산원, 만원)</h2>
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <LineChart data={roneChartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={PALETTE.border} vertical={false} />
                    <XAxis dataKey="ym" stroke={PALETTE.textMuted} fontSize={11} tickLine={false} />
                    <YAxis
                      stroke={PALETTE.textMuted} fontSize={11} tickLine={false} width={60}
                      tickFormatter={(v) => v.toLocaleString()}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                      labelStyle={{ color: PALETTE.textPrimary }}
                      formatter={(v) => (v == null ? '-' : `${Math.round(v).toLocaleString()}만원`)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {selected.filter((c) => !roneUnmapped.includes(c)).map((code, i) => (
                      <Line key={code} type="monotone" dataKey={labelFor(code)}
                        stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={styles.card} className="ui-card">
              <h2 style={styles.sectionTitle}>지역별 순위</h2>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={styles.th}>지역</th>
                    <th style={styles.th}>최근월 평균매매가격</th>
                    <th style={styles.th}>기간 등락률</th>
                  </tr>
                </thead>
                <tbody>
                  {roneRanking.map((r) => (
                    <tr key={r.code}>
                      <td style={styles.td}>{r.name}</td>
                      <td style={styles.td}>
                        {r.unsupported ? '미지원' : r.latest != null ? `${Math.round(r.latest).toLocaleString()}만원` : '-'}
                      </td>
                      <td style={{ ...styles.td, color: r.change > 0 ? PALETTE.up : r.change < 0 ? PALETTE.down : PALETTE.textSecondary }}>
                        {r.unsupported ? '-' : fmtPct(r.change)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </>
        )}

        {status === 'done' && !isRone && !isRatio && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              <div style={styles.card} className="ui-card">
                <div style={styles.kpiLabel}>조회된 거래 건수</div>
                <div style={styles.kpiValue}>{kpis.totalCount.toLocaleString()}건</div>
              </div>
              <div style={styles.card} className="ui-card">
                <div style={styles.kpiLabel}>선택 지역 평균 {unitLabel}</div>
                <div style={styles.kpiValue}>{kpis.avgPyeongAll ? fmtWon(kpis.avgPyeongAll) : '-'}</div>
              </div>
              {isRent && (
                <div style={styles.card} className="ui-card">
                  <div style={styles.kpiLabel}>평균 월세 (월세 있는 거래)</div>
                  <div style={styles.kpiValue}>{kpis.avgMonthlyRent ? `${Math.round(kpis.avgMonthlyRent).toLocaleString()}만` : '-'}</div>
                </div>
              )}
              <div style={styles.card} className="ui-card">
                <div style={styles.kpiLabel}>기간 내 최고 상승</div>
                <div style={{ ...styles.kpiValue, fontSize: 16, color: PALETTE.up, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <TrendingUp size={15} />
                  {kpis.rising ? `${kpis.rising.name} ${fmtPct(kpis.rising.change)}` : '-'}
                </div>
              </div>
              <div style={styles.card} className="ui-card">
                <div style={styles.kpiLabel}>기간 내 최고 하락</div>
                <div style={{ ...styles.kpiValue, fontSize: 16, color: PALETTE.down, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <TrendingDown size={15} />
                  {kpis.falling ? `${kpis.falling.name} ${fmtPct(kpis.falling.change)}` : '-'}
                </div>
              </div>
            </div>


            <div style={styles.card} className="ui-card">
              <h2 style={styles.sectionTitle}>
                {unitLabel} 추이 (만원/3.3㎡{isRent ? ', 전세 거래 기준' : ''})
              </h2>
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={PALETTE.border} vertical={false} />
                    <XAxis dataKey="ym" stroke={PALETTE.textMuted} fontSize={11} tickLine={false} />
                    <YAxis stroke={PALETTE.textMuted} fontSize={11} tickLine={false} width={48} />
                    <Tooltip contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                      labelStyle={{ color: PALETTE.textPrimary }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {selected.map((code, i) => (
                      <Line key={code} type="monotone" dataKey={labelFor(code)}
                        stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={styles.card} className="ui-card">
              <h2 style={styles.sectionTitle}>지역별 순위</h2>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={styles.th}>지역</th>
                    <th style={styles.th}>최근월 {unitLabel}</th>
                    <th style={styles.th}>기간 등락률</th>
                    <th style={styles.th}>거래건수</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((r) => (
                    <tr key={r.code}>
                      <td style={styles.td}>{r.name}</td>
                      <td style={styles.td}>{r.latestAvgPyeong ? fmtWon(r.latestAvgPyeong) : '-'}</td>
                      <td style={{ ...styles.td, color: r.change > 0 ? PALETTE.up : r.change < 0 ? PALETTE.down : PALETTE.textSecondary }}>
                        {fmtPct(r.change)}
                      </td>
                      <td style={styles.td}>{r.totalCount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>

            <div style={styles.card} className="ui-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: PALETTE.textSecondary }}>{isRent ? '보증금' : '매매가'} 금액대 (억원)</span>
                <input
                  type="number"
                  min="0"
                  placeholder="최소"
                  value={priceRange.min}
                  onChange={(e) => setPriceRange((p) => ({ ...p, min: e.target.value }))}
                  style={{ ...styles.select, width: 76, padding: '6px 8px' }}
                />
                <span style={{ color: PALETTE.textMuted }}>~</span>
                <input
                  type="number"
                  min="0"
                  placeholder="최대"
                  value={priceRange.max}
                  onChange={(e) => setPriceRange((p) => ({ ...p, max: e.target.value }))}
                  style={{ ...styles.select, width: 76, padding: '6px 8px' }}
                />
                {(priceRange.min !== '' || priceRange.max !== '') && (
                  <button
                    onClick={() => setPriceRange({ min: '', max: '' })}
                    style={{ border: `1px solid ${PALETTE.border}`, background: PALETTE.panelAlt, borderRadius: 8, padding: '5px 10px', fontSize: 11.5, cursor: 'pointer', color: PALETTE.textSecondary }}
                  >
                    필터 해제
                  </button>
                )}
                <span style={{ fontSize: 11, color: PALETTE.textMuted }}>
                  {allTxFiltered.length.toLocaleString()}건 표시 중
                </span>
              </div>
            </div>

            {undervaluedPicks.length > 0 && (
              <div style={styles.card} className="ui-card">
                <h2 style={styles.sectionTitle}>가격 비교군 하위권 단지</h2>
                <p style={{ fontSize: 11, color: PALETTE.textMuted, margin: '-6px 0 12px' }}>
                  같은 지역·비슷한 평형 단지들과 비교했을 때 평당가가 상대적으로 낮은 단지예요. 공식 시세평가가 아니라 지금 조회된 데이터 안에서의 참고용 점수예요.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                  {undervaluedPicks.map((c) => (
                    <div
                      key={`${c.regionCode}|${c.dong}|${c.apt}`}
                      style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: 12, cursor: 'pointer' }}
                      onClick={() => setSelectedApt({ apt: c.apt, dong: c.dong, regionCode: c.regionCode })}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{c.apt}</div>
                        <ZBadge z={c.z} />
                      </div>
                      <div style={{ fontSize: 10.5, color: PALETTE.textMuted, marginTop: 2 }}>{labelFor(c.regionCode)} {c.dong}</div>
                      <div style={{ fontSize: 13, fontWeight: 800, marginTop: 6 }}>{fmtManwon(Math.round(c.unitPrice))}/평</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {crossDealStats.length > 0 && (
              <div style={styles.card} className="ui-card">
                <h2 style={styles.sectionTitle}>매매 ↔ 전세 평당가 비교</h2>
                <p style={{ fontSize: 11, color: PALETTE.textMuted, margin: '-6px 0 12px' }}>
                  선택하신 지역의 최근월 매매 평당가와 전세 평당가예요 (전세가율 = 전세/매매 × 100).
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                  {crossDealStats.map((c) => (
                    <div key={c.code} style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: 12 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>{c.name}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: '#B23A2E' }}>매매 {fmtManwon(Math.round(c.salePyeong))}</span>
                        <span style={{ color: '#3182F7' }}>전세 {fmtManwon(Math.round(c.jeonsePyeong))}</span>
                      </div>
                      <div style={{ fontSize: 11, color: PALETTE.textMuted, marginTop: 4 }}>전세가율 {c.ratio.toFixed(1)}%</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={styles.card} className="ui-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <h2 style={{ ...styles.sectionTitle, margin: 0 }}>단지별 비교</h2>
                <select
                  value={complexSort}
                  onChange={(e) => setComplexSort(e.target.value)}
                  style={{ ...styles.select, width: 'auto', fontSize: 12, padding: '6px 8px' }}
                >
                  <option value="price">평당가 낮은순</option>
                  <option value="change">상승률 높은순</option>
                  <option value="recent">최근 거래순</option>
                </select>
              </div>
              <p style={{ fontSize: 11, color: PALETTE.textMuted, margin: '8px 0 12px' }}>
                {{
                  price: '값이 비슷한 단지끼리 가까이 있어서 한눈에 비교하기 좋아요.',
                  change: '조회 기간 내 가격이 많이 오른 단지부터 보여드려요.',
                  recent: '가장 최근에 거래된 단지부터 보여드려요.',
                }[complexSort]} 단지명을 누르면 상세 내역이 열립니다.
              </p>
              <div style={{ maxHeight: 320, overflowY: 'auto', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...styles.th, width: 70 }}>지역</th>
                      <th style={{ ...styles.th, width: 200 }}>단지명</th>
                      <th style={{ ...styles.th, width: 60 }}>동</th>
                      <th style={{ ...styles.th, width: 50 }}>층</th>
                      <th style={{ ...styles.th, width: 130 }}>전용면적</th>
                      <th style={{ ...styles.th, width: 120 }}>최근 {isRent ? '보증금' : '거래금액'}</th>
                      <th style={{ ...styles.th, width: 80 }}>등락률</th>
                      <th style={{ ...styles.th, width: 90 }}>최근 계약일</th>
                      <th style={{ ...styles.th, width: 70 }}>거래건수</th>
                      <th style={{ ...styles.th, width: 110 }}>층 분포</th>
                      <th style={{ ...styles.th, width: 78 }}>참고 평가</th>
                      <th style={{ ...styles.th, width: 90 }}>추이</th>
                    </tr>
                  </thead>
                  <tbody>
                    {complexCompare.map((c, i) => (
                      <tr key={i}>
                        <td style={styles.td}>{labelFor(c.regionCode)}</td>
                        <td
                          style={{ ...styles.td, color: PALETTE.accent, cursor: 'pointer', textDecoration: 'underline' }}
                          onClick={() => setSelectedApt({ apt: c.apt, dong: c.dong, regionCode: c.regionCode })}
                        >
                          {c.apt} ({c.dong})
                        </td>
                        <td style={styles.td}>{c.aptDong ? `${c.aptDong}동` : '-'}</td>
                        <td style={styles.td}>{c.floor}층</td>
                        <td style={styles.td}>{fmtArea(c.area)}</td>
                        <td style={styles.td}>{fmtManwon(isRent ? c.deposit : c.amount)}</td>
                        <td style={{ ...styles.td, color: c.change > 0 ? PALETTE.up : c.change < 0 ? PALETTE.down : PALETTE.textPrimary }}>
                          {fmtPct(c.change)}
                        </td>
                        <td style={styles.td}>{c.year}.{c.month}.{c.day}</td>
                        <td style={styles.td}>{c.count}</td>
                      <td style={styles.td}>{floorDistLabel(c.floorDist)}</td>
                      <td style={styles.td}><ZBadge z={complexValuation[`${c.regionCode}|${c.dong}|${c.apt}`]} /></td>
                      <td style={styles.td}><Sparkline points={complexSparklines[`${c.regionCode}|${c.dong}|${c.apt}`]} /></td>
                      </tr>
                    ))}
                    {complexCompare.length === 0 && (
                      <tr><td style={styles.td} colSpan={11}>비교할 단지가 없습니다.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={styles.card} className="ui-card">
              <h2 style={styles.sectionTitle}>최근 거래 내역</h2>
              <div style={{ maxHeight: 320, overflowY: 'auto', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...styles.th, width: 70 }}>지역</th>
                      <th style={{ ...styles.th, width: 200 }}>단지명</th>
                      <th style={{ ...styles.th, width: 60 }}>동</th>
                      <th style={{ ...styles.th, width: 90 }}>계약일</th>
                      <th style={{ ...styles.th, width: 130 }}>전용면적</th>
                      <th style={{ ...styles.th, width: 50 }}>층</th>
                      {isRent ? (
                        <>
                          <th style={{ ...styles.th, width: 55 }}>구분</th>
                          <th style={{ ...styles.th, width: 110 }}>보증금</th>
                          <th style={{ ...styles.th, width: 90 }}>월세</th>
                        </>
                      ) : (
                        <th style={{ ...styles.th, width: 120 }}>거래금액</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {recentTx.map((t, i) => (
                      <tr key={i}>
                        <td style={styles.td}>{labelFor(t.regionCode)}</td>
                        <td style={{ ...styles.td, color: PALETTE.accent, cursor: 'pointer', textDecoration: 'underline' }}
                          onClick={() => setSelectedApt({ apt: t.apt, dong: t.dong, regionCode: t.regionCode })}>
                          {t.apt} ({t.dong})
                        </td>
                        <td style={styles.td}>{t.aptDong ? `${t.aptDong}동` : '-'}</td>
                        <td style={styles.td}>{t.year}.{t.month}.{t.day}</td>
                        <td style={styles.td}>{fmtArea(t.area)}</td>
                        <td style={styles.td}>{t.floor}층</td>
                        {isRent ? (
                          <>
                            <td style={styles.td}>{t.isJeonse ? '전세' : '월세'}</td>
                            <td style={styles.td}>{fmtManwon(t.deposit)}</td>
                            <td style={styles.td}>{t.isJeonse ? '-' : `${t.monthlyRent.toLocaleString()}만원`}</td>
                          </>
                        ) : (
                          <td style={styles.td}>{fmtManwon(t.amount)}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {status === 'idle' && (
          <div style={{ ...styles.card, textAlign: 'center', padding: '60px 20px', color: PALETTE.textMuted }} className="ui-card">
            <Building2 size={28} color={PALETTE.border} style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 14 }}>아직 조회된 데이터가 없어요</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>왼쪽 패널에서 지역과 기간을 정하고 "데이터 조회"를 눌러주세요.</div>
          </div>
        )}

        {status === 'loading' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={styles.card} className="ui-card">
                <div className="skeleton" style={{ width: '60%', height: 11, marginBottom: 10 }} />
                <div className="skeleton" style={{ width: '80%', height: 24 }} />
              </div>
            ))}
          </div>
        )}
      </main>
      )}

      {selectedApt && (
        <ComplexDetail
          variant={viewMode === 'map' ? 'panel' : 'modal'}
          selectedApt={selectedApt} setSelectedApt={setSelectedApt}
          aptHistory={aptHistory} aptHistoryLoading={aptHistoryLoading} aptHistoryFullRange={aptHistoryFullRange}
          aptHistoryFiltered={aptHistoryFiltered} aptHistoryAreaOptions={aptHistoryAreaOptions}
          loadFullAptHistory={loadFullAptHistory}
          aptSummary={aptSummary} aptTrendData={aptTrendData} aptTrendByArea={aptTrendByArea} aptVolumeData={aptVolumeData}
          isRent={isRent} isRatio={isRatio} isRone={isRone}
          calcPriceInput={calcPriceInput} setCalcPriceInput={setCalcPriceInput}
          tradeUpCurrentPrice={tradeUpCurrentPrice} setTradeUpCurrentPrice={setTradeUpCurrentPrice}
          tradeUpLoanBalance={tradeUpLoanBalance} setTradeUpLoanBalance={setTradeUpLoanBalance}
          tradeUpTargetPrice={tradeUpTargetPrice} setTradeUpTargetPrice={setTradeUpTargetPrice}
          terrainInfo={terrainInfo} terrainLoading={terrainLoading} winterSun={winterSun}
          poiInfo={poiInfo} poiLoading={poiLoading}
          gongsiInfo={gongsiInfo} gongsiLoading={gongsiLoading}
          aptBasicInfo={aptBasicInfo} nearestStationInfo={nearestStationInfo}
          nearbySchools={nearbySchools} schoolsLoading={schoolsLoading}
          nearbyRadius={nearbyRadius} setNearbyRadius={setNearbyRadius}
          nearbyComplexes={nearbyComplexes} radiusSummary={radiusSummary}
          similarComplexes={similarComplexes}
          pinnedComplexes={pinnedComplexes} setPinnedComplexes={setPinnedComplexes}
          setMapFocusKeys={setMapFocusKeys} setViewMode={setViewMode}
          aptJeonseInfo={aptJeonseInfo}
          alertFormOpen={alertFormOpen} setAlertFormOpen={setAlertFormOpen}
          alertDirection={alertDirection} setAlertDirection={setAlertDirection}
          alertTargetPrice={alertTargetPrice} setAlertTargetPrice={setAlertTargetPrice}
          alertSaving={alertSaving} submitAlert={submitAlert}
          historyAreaFilter={historyAreaFilter} setHistoryAreaFilter={setHistoryAreaFilter}
          historyListLimit={historyListLimit} setHistoryListLimit={setHistoryListLimit}
          trendViewMode={trendViewMode} setTrendViewMode={setTrendViewMode}
          styles={styles}
        />
      )}

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
        }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shimmer { 0% { background-position: -200px 0; } 100% { background-position: 200px 0; } }
        .ui-card:hover { box-shadow: 0 6px 16px rgba(33,31,26,0.08); transform: translateY(-1px); }
        .ui-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(178,58,46,0.32); }
        .ui-btn:active:not(:disabled) { transform: translateY(0); opacity: 0.92; }
        .ui-btn:disabled { opacity: 0.65; cursor: default; }
        .skeleton {
          background: linear-gradient(90deg, ${PALETTE.panelAlt} 25%, ${PALETTE.border} 50%, ${PALETTE.panelAlt} 75%);
          background-size: 400px 100%;
          animation: shimmer 1.3s infinite linear;
          border-radius: 6px;
        }
        .spin { animation: spin 1s linear infinite; }
        @media (max-width: 720px) {
          .hero-wrap { flex-direction: column !important; height: 90vh !important; }
          .dash-sidebar-fixed {
            width: 100% !important; height: 58vh !important; border-right: none !important;
            border-bottom: 1px solid ${PALETTE.border};
          }
          .dash-main { padding: 16px !important; }
          .dash-title { font-size: 20px !important; }
          .main-nav { gap: 0 !important; }
          .main-nav > div { padding: 0 6px !important; font-size: 11px !important; }
          .header-search { display: none !important; }
          .map-complex-panel { width: 240px !important; top: 68px !important; bottom: 12px !important; }
          .map-status-card { display: none !important; }
          .map-portal-toolbar { top: 8px !important; left: 8px !important; right: 8px !important; }
        }
        @media (max-width: 520px) {
          .map-complex-panel { left: 8px !important; right: 8px !important; width: auto !important; top: auto !important; height: 34vh !important; bottom: 8px !important; }
          .map-portal-toolbar { right: 8px !important; }
          .portal-pill { padding: 7px 9px !important; }
        }
      `}</style>
    </div>
  );
}

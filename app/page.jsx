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
import { nearestStation } from '../lib/subway';
import { SIDO_REGIONS, roneRegionLabel } from '../lib/rone-regions';

const RONE_ONLY_EXTRA = SIDO_REGIONS.filter((r) => ['90001', '90002', '90003'].includes(r.code));

const DEFAULT_SELECTED = [];
const LINE_COLORS = ['#C79A46', '#5B8AA6', '#B85C4A', '#6B8F5E', '#8B7EC8', '#C4763A'];
const SIDO_SHORT_NAMES = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];

const PALETTE = {
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
const ACCENT_TEXT = '#FFFFFF';

function fmtWon(manwon) {
  if (manwon == null || Number.isNaN(manwon)) return '-';
  const eok = manwon / 10000;
  if (Math.abs(eok) >= 1) return `${eok.toFixed(2)}억`;
  return `${Math.round(manwon).toLocaleString()}만`;
}

function fmtPct(v) {
  if (v == null || Number.isNaN(v)) return '-';
  const s = v > 0 ? '+' : '';
  return `${s}${v.toFixed(1)}%`;
}

// 국토부 API는 전용면적(㎡)만 제공하고 공급면적은 주지 않아서 (건물마다 비율이 달라 정확한
// 환산이 불가능), 평 단위 전용면적만 정수로 보여준다.
function fmtPyeong(area) {
  if (area == null || Number.isNaN(area)) return '-';
  return `${Math.round(area / 3.3058)}평`;
}

// 전용면적을 ㎡와 평 두 단위로 같이 보여준다 (소수점 없이).
function fmtArea(area) {
  if (area == null || Number.isNaN(area)) return '-';
  return `${Math.round(area)}㎡(${Math.round(area / 3.3058)}평)`;
}

// 억 단위로 안 바꾸고 항상 만원 단위 그대로 보여준다.
function fmtManwon(manwon) {
  if (manwon == null || Number.isNaN(manwon)) return '-';
  return `${Math.round(manwon).toLocaleString()}만원`;
}

// 취득세 대략 계산 (1주택자 기준 표준세율 근사치 + 지방교육세 등). 다주택자 중과, 생애최초 감면 등은
// 반영하지 않은 단순 참고용 수치이며, 실제 세액은 취득 시점 법령과 세무사 확인이 필요하다.
function calcAcquisitionTax(amountManwon) {
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
function calcLoanEstimate(amountManwon, isRegulated) {
  if (!amountManwon) return null;
  const ltv = isRegulated ? 0.4 : 0.7;
  return { ltv, maxLoan: amountManwon * ltv };
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

function monthLabel(ym) {
  return `${ym.slice(0, 4)}.${ym.slice(4, 6)}`;
}

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

function labelFor(code) {
  return roneRegionLabel(code, regionLabel(code));
}

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
  const [userAlerts, setUserAlerts] = useState([]);
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
        return g.sido.replace(/특별자치시|특별자치도|광역시|특별시|도$/, '');
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
        if (p == null) return false;
        if (unitSizeFilter === 'u20' && !(p < 20)) return false;
        if (unitSizeFilter === '20s' && !(p >= 20 && p < 30)) return false;
        if (unitSizeFilter === '30s' && !(p >= 30 && p < 40)) return false;
        if (unitSizeFilter === '40s' && !(p >= 40 && p < 50)) return false;
        if (unitSizeFilter === '50p' && !(p >= 50)) return false;
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

  const allTxFiltered = useMemo(() => {
    if (priceRange.min === '' && priceRange.max === '') return allTx;
    const min = priceRange.min === '' ? null : parseFloat(priceRange.min);
    const max = priceRange.max === '' ? null : parseFloat(priceRange.max);
    return allTx.filter((t) => {
      const v = isRent ? t.deposit : t.amount;
      if (v == null) return false;
      const eok = v / 10000;
      if (min != null && Number.isFinite(min) && eok < min) return false;
      if (max != null && Number.isFinite(max) && eok > max) return false;
      return true;
    });
  }, [allTx, priceRange, isRent]);

  const recentTx = useMemo(() => allTxFiltered.slice(0, 30), [allTxFiltered]);

  const [aptHistory, setAptHistory] = useState([]);
  const [aptHistoryLoading, setAptHistoryLoading] = useState(false);
  const [historyAreaFilter, setHistoryAreaFilter] = useState('all');

  useEffect(() => {
    setAptHistory([]);
    setCalcPriceInput('');
    if (!selectedApt) return undefined;
    let cancelled = false;
    setAptHistoryLoading(true);
    const endYmH = ymNow();
    const startYmH = ymShift(endYmH, -239); // 최대 20년치 — 국토부 실거래가 공개 시작(2006년) 즈음까지
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
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setAptHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [selectedApt, isSilv, propertyType, isRent]);

  const [gongsiInfo, setGongsiInfo] = useState(null);
  const [gongsiLoading, setGongsiLoading] = useState(false);
  const [gongsiError, setGongsiError] = useState('');

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
    const ymAgo = ymShift(ymNow(), -12);
    const yearAgo = aptHistory.filter((t) => ymOf(t) >= ymAgo && ymOf(t) <= ymShift(ymNow(), -10));
    const yearAgoPrices = yearAgo.map(priceOf).filter((v) => v != null);
    const recentAvg = recentPrices.length ? recentPrices.reduce((s, v) => s + v, 0) / recentPrices.length : null;
    const yearAgoAvg = yearAgoPrices.length ? yearAgoPrices.reduce((s, v) => s + v, 0) / yearAgoPrices.length : null;
    const yoyChange = recentAvg != null && yearAgoAvg ? ((recentAvg - yearAgoAvg) / yearAgoAvg) * 100 : null;
    const sorted = [...aptHistory].sort((a, b) => (priceOf(b) ?? 0) - (priceOf(a) ?? 0));
    const maxTx = sorted[0];
    return {
      recentAvg,
      recentCount: recent.length,
      yearAgoAvg,
      yoyChange,
      maxPrice: maxTx ? priceOf(maxTx) : null,
      maxLabel: maxTx ? `${fmtArea(maxTx.area)} · ${maxTx.year}.${String(maxTx.month).padStart(2, '0')}` : '-',
    };
  }, [aptHistory, isRent]);

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

  const findDongCentroid = (regionCode, dong) => {
    const exact = dongCentroids[`${regionCode}|${normalizeDongName(dong)}`];
    if (exact) return exact;
    // 국토부 실거래 데이터는 "법정동"(예: 광안동), 동 경계 지도는 "행정동"(예: 광안4동) 기준이라
    // 이름이 정확히 안 맞는 경우가 있다 — 같은 지역 안에서 이름이 겹치는(앞부분이 같은) 동을 찾아
    // 그 중심점들을 평균 내서 대략의 위치라도 잡아준다.
    const root = normalizeDongName(dong).replace(/동$/, '');
    if (!root) return null;
    const matches = Object.entries(dongCentroids)
      .filter(([k]) => k.startsWith(`${regionCode}|`) && k.slice(regionCode.length + 1).startsWith(root));
    if (matches.length === 0) return null;
    const lat = matches.reduce((s, [, v]) => s + v.lat, 0) / matches.length;
    const lng = matches.reduce((s, [, v]) => s + v.lng, 0) / matches.length;
    return { lat, lng };
  };

  const MAX_MAP_COMPLEXES = 800;

  const mapComplexes = useMemo(() => {
    const seen = new Set();
    const list = [];
    const addItem = (apt, dong, regionCode) => {
      if (!apt || !dong || !regionCode) return;
      const key = `${regionCode}|${dong}|${apt}`;
      if (seen.has(key)) return;
      seen.add(key);
      const coord = findDongCentroid(regionCode, dong);
      list.push({ key, apt, dong, regionCode, regionName: regionLabel(regionCode), lat: coord?.lat, lng: coord?.lng });
    };
    // 실거래가 있는 단지를 먼저 채우고, 남는 자리만큼만 나머지 단지로 채운다.
    // 좌표가 이미(동 중심점으로) 확보된 단지는 카카오 검색이 필요 없어 훨씬 가볍다.
    allTx.forEach((t) => addItem(t.apt, t.dong, t.regionCode));
    for (const c of fullComplexList) {
      if (list.length >= MAX_MAP_COMPLEXES) break;
      addItem(c.apt, c.dong, c.regionCode);
    }
    return list.slice(0, MAX_MAP_COMPLEXES);
  }, [allTx, fullComplexList, dongCentroids]);

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
    const lastMonth = months[months.length - 1];
    const items = rawByRegionMonth[`${code}_${lastMonth}`] || [];
    const valid = items.map((r) => r.pricePerPyeong).filter(Boolean);
    return valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
  };

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
  }, [mapDisplayFeatures, selected, rawByRegionMonth, months, roneRanking, ratioRanking, dealType]);

  const seoulMapData = useMemo(() => {
    if (!mapDisplayFeatures || !mapValues) return null;
    const available = mapValues.filter((v) => v != null);
    const min = available.length ? Math.min(...available) : 0;
    const max = available.length ? Math.max(...available) : 1;
    return { features: mapDisplayFeatures, values: mapValues, min, max };
  }, [mapDisplayFeatures, mapValues]);

  // "동" 단위 지도 데이터 — 선택된 지역이 속한 시/도만 필요할 때 받아온다.
  const [mapZoomTier, setMapZoomTier] = useState('far');
  const loadedSidosRef = useRef(new Set());

  useEffect(() => {
    // 확대를 많이 안 하면(구 단위로만 보고 있으면) "동" 데이터는 아예 필요 없으므로,
    // 실제로 확대했을 때만 받아온다 — 안 그러면 지역 선택할 때마다 큰 파일을 미리 받아와서 느려진다.
    if (mapZoomTier === 'far') return undefined;
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
  }, [selected, mapZoomTier]);

  const dongMapData = useMemo(() => {
    if (dongRawFeatures.length === 0) return null;
    const relevant = dongRawFeatures.filter((f) => selected.some((code) => expandRegionCode(code).includes(f.regionCode)));
    const values = relevant.map((f) => {
      const rows = allTx.filter((t) => t.regionCode === f.regionCode && normalizeDongName(t.dong) === normalizeDongName(f.name));
      const vals = rows
        .map((r) => (isRent ? (r.isJeonse ? r.depositPerPyeong : null) : r.pricePerPyeong))
        .filter((v) => v != null);
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    });
    const available = values.filter((v) => v != null);
    const min = available.length ? Math.min(...available) : 0;
    const max = available.length ? Math.max(...available) : 1;
    return {
      features: relevant.map((f) => ({ feature: f.feature, name: f.name, code: f.regionCode })),
      values,
      min,
      max,
    };
  }, [dongRawFeatures, selected, allTx, isRent]);

  const renderSeoulMap = () => {
    const heroWrap = (content) => (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>{content}</div>
    );
    const emptyState = (msg) => heroWrap(
      <div style={{
        width: '100%', height: '100%', background: PALETTE.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: PALETTE.textMuted, fontSize: 13, textAlign: 'center', padding: 20,
      }}>
        {msg}
      </div>,
    );
    if (mapError) return emptyState(mapError);
    if (!seoulMapData) return emptyState('지도 불러오는 중...');

    const featureCollection = { type: 'FeatureCollection', features: seoulMapData.features.map((f) => f.feature) };
    const projection = geoMercator().fitSize([560, 480], featureCollection);
    const pathGen = geoPath(projection);
    const colorFor = (value) => {
      if (value == null) return PALETTE.panelAlt;
      const { min, max } = seoulMapData;
      const t = max > min ? (value - min) / (max - min) : 0.5;
      const from = [245, 244, 239];
      const to = [178, 58, 46];
      const mix = from.map((c, i) => Math.round(c + (to[i] - c) * t));
      return `rgb(${mix.join(',')})`;
    };

    return heroWrap(
      <>
        {process.env.NEXT_PUBLIC_NAVER_MAP_KEY_ID ? (
          <NaverChoropleth
            features={seoulMapData.features}
            values={seoulMapData.values}
            colorFor={colorFor}
            borderColor={PALETTE.border}
            onSelect={(code) => addRegionAndFetch(code)}
            focusLatLng={focusLatLng}
            complexes={mapComplexes}
            onComplexSelect={(c) => setSelectedApt({ apt: c.apt, dong: c.dong, regionCode: c.regionCode, lat: c.lat, lng: c.lng })}
            dongFeatures={dongMapData?.features}
            dongValues={dongMapData?.values}
            onZoomTierChange={setMapZoomTier}
            height="100%"
          />
        ) : process.env.NEXT_PUBLIC_KAKAO_MAP_KEY ? (
          <KakaoChoropleth
            features={seoulMapData.features}
            values={seoulMapData.values}
            colorFor={colorFor}
            borderColor={PALETTE.border}
            onSelect={(code) => addRegionAndFetch(code)}
            focusLatLng={focusLatLng}
            complexes={mapComplexes}
            onComplexSelect={(c) => setSelectedApt({ apt: c.apt, dong: c.dong, regionCode: c.regionCode, lat: c.lat, lng: c.lng })}
            dongFeatures={dongMapData?.features}
            dongValues={dongMapData?.values}
            onZoomTierChange={setMapZoomTier}
            height="100%"
          />
        ) : (
          <svg viewBox="0 0 560 480" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block', background: PALETTE.bg }}>
            {seoulMapData.features.map((f, idx) => {
              const value = seoulMapData.values[idx];
              return (
                <path
                  key={f.name + idx}
                  d={pathGen(f.feature)}
                  fill={colorFor(value)}
                  stroke={PALETTE.border}
                  strokeWidth={0.75}
                  style={{ cursor: f.code ? 'pointer' : 'default' }}
                  onClick={() => f.code && addRegionAndFetch(f.code)}
                >
                  <title>{f.name}{value != null ? `: ${Math.round(value).toLocaleString()}` : ' (데이터 없음)'}</title>
                </path>
              );
            })}
          </svg>
        )}
        {seoulMapData.max > seoulMapData.min && (
          <div style={{
            position: 'absolute', left: 16, bottom: 16, zIndex: 20,
            background: 'rgba(255,255,255,0.94)', border: `1px solid ${PALETTE.border}`, borderRadius: 8,
            padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 10.5, color: PALETTE.textSecondary, boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          }}>
            <span>낮음</span>
            <div style={{
              width: 90, height: 8, borderRadius: 4,
              background: `linear-gradient(90deg, rgb(245,244,239), ${PALETTE.accent})`,
            }} />
            <span>높음</span>
          </div>
        )}
      </>,
    );
  };


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
      <div style={{
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
      <div className="hero-wrap" style={{ display: 'flex', width: '100%', height: '100vh', overflow: 'hidden' }}>
        {panelOpen ? (
          <aside
            style={{
              ...styles.sidebar,
              width: 300, flexShrink: 0, height: '100%', minHeight: 0, overflowY: 'auto',
              borderRight: `1px solid ${PALETTE.border}`,
            }}
            className="dash-sidebar-fixed"
          >
            {sidebarInner}
          </aside>
        ) : (
          <button
            onClick={() => setPanelOpen(true)}
            style={{
              width: 28, flexShrink: 0, height: '100%', border: 'none', borderRight: `1px solid ${PALETTE.border}`,
              background: PALETTE.panel, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="패널 펼치기"
          >
            <ChevronRight size={16} color={PALETTE.textMuted} />
          </button>
        )}

        <div style={{ position: 'relative', flex: 1, touchAction: 'none', minWidth: 0 }}>
          {renderSeoulMap()}

          {/* 지도 위 탐색 도구: 거래유형을 사이드바로 안 가고 바로 바꿀 수 있게 */}
          <div className="map-portal-toolbar" style={{
            position: 'absolute', top: 14, left: 14, right: 14, zIndex: 20,
            display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none',
          }}>
            <div style={{
              pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 4,
              background: 'rgba(255,255,255,0.96)', border: `1px solid ${PALETTE.border}`,
              borderRadius: 12, padding: 5, boxShadow: '0 4px 18px rgba(0,0,0,0.10)',
              backdropFilter: 'blur(8px)', overflowX: 'auto', maxWidth: 'calc(100% - 10px)',
            }}>
              {[['trade', '매매'], ['rent', '전월세'], ['silv', '분양권'], ['rone', '시세동향'], ['ratio', '전세가율']].map(([key, label]) => (
                <button key={key} className="portal-pill" onClick={() => setDealTypeSafe(key)} style={{
                  border: 'none', borderRadius: 9, padding: '8px 12px', whiteSpace: 'nowrap',
                  background: dealType === key ? PALETTE.accent : 'transparent',
                  color: dealType === key ? '#fff' : PALETTE.textSecondary,
                  fontSize: 12, fontWeight: dealType === key ? 700 : 500, cursor: 'pointer',
                }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="map-status-card" style={{
              marginLeft: 'auto', pointerEvents: 'auto', background: 'rgba(255,255,255,0.96)',
              border: `1px solid ${PALETTE.border}`, borderRadius: 12, padding: '9px 12px',
              boxShadow: '0 4px 18px rgba(0,0,0,0.10)', fontSize: 11.5, whiteSpace: 'nowrap',
            }}>
              <b>{selected.length}</b>개 지역 · <b>{allTx.length.toLocaleString()}</b>건 조회
            </div>
          </div>

          {/* 지도 위 단지 탐색 패널: 실거래가가 있는 단지를 바로 선택 */}
          {allTx.length > 0 && (
            <div className="map-complex-panel" style={{
              position: 'absolute', top: 72, right: 14, bottom: 18, width: 292, zIndex: 19,
              background: 'rgba(255,255,255,0.97)', border: `1px solid ${PALETTE.border}`,
              borderRadius: 14, boxShadow: '0 8px 28px rgba(0,0,0,0.12)', overflow: 'hidden',
              backdropFilter: 'blur(10px)',
            }}
            >
              <div style={{ padding: '14px 14px 10px', borderBottom: `1px solid ${PALETTE.border}` }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>단지 탐색</div>
                <div style={{ fontSize: 11, color: PALETTE.textMuted, marginTop: 3 }}>
                  최근 거래가 있는 단지를 선택하면 상세정보를 확인할 수 있어요.
                </div>
              </div>
              <div style={{ overflowY: 'auto', height: 'calc(100% - 64px)' }}>
                {complexCompare.slice(0, 40).map((c, i) => {
                  const coord = codeToLatLng[c.regionCode];
                  return (
                    <button
                      key={`${c.regionCode}|${c.dong}|${c.apt}|${i}`}
                      onClick={() => {
                        setSelectedApt({ apt: c.apt, dong: c.dong, regionCode: c.regionCode, lat: coord?.lat, lng: coord?.lng });
                      }}
                      style={{
                        width: '100%', textAlign: 'left', border: 'none', borderBottom: `1px solid ${PALETTE.border}`,
                        background: 'transparent', padding: '11px 14px', cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.apt}</div>
                          <div style={{ fontSize: 10.5, color: PALETTE.textMuted, marginTop: 3 }}>{regionLabel(c.regionCode)} {c.dong} · {c.count}건</div>
                        </div>
                        <div style={{ flexShrink: 0, textAlign: 'right' }}>
                          <div style={{ fontSize: 12.5, fontWeight: 800 }}>{fmtWon(isRent ? c.deposit : c.amount)}</div>
                          <div style={{ fontSize: 10, color: PALETTE.textMuted, marginTop: 3 }}>{fmtArea(c.area)}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      ) : viewMode === 'compare' ? (
      <div style={{ padding: '20px 20px 0' }}>
        <div style={styles.card} className="ui-card">
          <h2 style={styles.sectionTitle}>비교분석</h2>
          <p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: '-6px 0 14px' }}>
            지역이나 단지를 최대 3개까지 골라서 {isRent ? '전세보증금' : '매매가'} 평당가 추이를 나란히 비교해요.
          </p>

          <div style={{ marginBottom: 16 }}>
            <label style={styles.label}>비교할 지역 새로 추가 (여기서 바로 불러옵니다)</label>
            <select
              value={comparePickerValue}
              onChange={(e) => addRegionAndFetch(e.target.value)}
              style={{ ...styles.select, fontSize: 13 }}
            >
              <option value="">시/도 - 시/군/구 선택</option>
              {REGION_GROUPS.map((g) => {
                const agg = SIDO_AGGREGATES.find((a) => a.sido === g.sido);
                return (
                  <optgroup key={g.sido} label={g.sido}>
                    {agg && <option key={agg.code} value={agg.code}>{agg.name}</option>}
                    {g.items.map((it) => (
                      <option key={it.code} value={it.code}>{it.name}</option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            {status === 'loading' && (
              <p style={{ fontSize: 11.5, color: PALETTE.textMuted, marginTop: 4 }}>불러오는 중...</p>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              { key: compareAKey, set: setCompareAKey, label: 'A' },
              { key: compareBKey, set: setCompareBKey, label: 'B' },
              { key: compareCKey, set: setCompareCKey, label: 'C' },
            ].map((slot) => (
              <div key={slot.label}>
                <label style={styles.label}>비교 대상 {slot.label}</label>
                <select
                  value={slot.key}
                  onChange={(e) => slot.set(e.target.value)}
                  style={{ ...styles.select, fontSize: 13 }}
                >
                  <option value="">선택 안 함</option>
                  <optgroup label="지역">
                    {compareOptions.filter((o) => o.kind === 'region').map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="단지">
                    {compareOptions.filter((o) => o.kind === 'apt').map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </optgroup>
                </select>
              </div>
            ))}
          </div>

          {compareOptions.length === 0 && (
            <p style={{ fontSize: 12.5, color: PALETTE.textMuted }}>
              위에서 지역을 하나 추가해보세요. 불러온 지역과 그 안의 단지들이 비교 대상 선택지로 나와요.
            </p>
          )}

          {(compareAKey || compareBKey || compareCKey) && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
                {[
                  { result: compareAResult, label: 'A' },
                  { result: compareBResult, label: 'B' },
                  { result: compareCResult, label: 'C' },
                ].map((slot) => (
                  <div key={slot.label} style={{ ...styles.card, borderStyle: 'dashed' }}>
                    <div style={styles.kpiLabel}>{slot.label} 기간 등락률</div>
                    <div style={{ ...styles.kpiValue, fontSize: 18, color: slot.result.changePct > 0 ? PALETTE.up : slot.result.changePct < 0 ? PALETTE.down : PALETTE.textPrimary }}>
                      {slot.result.label ? fmtPct(slot.result.changePct) : '-'}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ width: '100%', height: 300, marginBottom: 20 }}>
                <ResponsiveContainer>
                  <LineChart data={compareChartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={PALETTE.border} vertical={false} />
                    <XAxis dataKey="ym" stroke={PALETTE.textMuted} fontSize={11} tickLine={false} />
                    <YAxis stroke={PALETTE.textMuted} fontSize={11} tickLine={false} width={48} />
                    <Tooltip contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                      labelStyle={{ color: PALETTE.textPrimary }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {[compareAResult, compareBResult, compareCResult].map((r, i) => (
                      r.label && (
                        <Line key={r.label} type="monotone" dataKey={r.label} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                      )
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <h3 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px', color: PALETTE.textPrimary }}>
                최근 평당가 비교 (만원)
              </h3>
              <div style={{ width: '100%', height: 200, marginBottom: 20 }}>
                <ResponsiveContainer>
                  <BarChart data={compareBarData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={PALETTE.border} vertical={false} />
                    <XAxis dataKey="name" stroke={PALETTE.textMuted} fontSize={11} tickLine={false} />
                    <YAxis stroke={PALETTE.textMuted} fontSize={11} tickLine={false} width={48} />
                    <Tooltip contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                      labelStyle={{ color: PALETTE.textPrimary }} />
                    <Bar dataKey="평당가" radius={[4, 4, 0, 0]}>
                      {compareBarData.map((_, i) => <Cell key={i} fill={LINE_COLORS[i % LINE_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <h3 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px', color: PALETTE.textPrimary }}>
                요약 비교표
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={styles.th}>대상</th>
                      <th style={styles.th}>최근 평당가</th>
                      <th style={styles.th}>기간 등락률</th>
                      <th style={styles.th}>최고가</th>
                      <th style={styles.th}>최저가</th>
                      <th style={styles.th}>평균 전용면적</th>
                      <th style={styles.th}>거래건수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareResultsList.map((r) => (
                      <tr key={r.label}>
                        <td style={styles.td}>{r.label}</td>
                        <td style={styles.td}>{r.latest != null ? fmtWon(r.latest) : '-'}</td>
                        <td style={{ ...styles.td, color: r.changePct > 0 ? PALETTE.up : r.changePct < 0 ? PALETTE.down : PALETTE.textPrimary }}>
                          {fmtPct(r.changePct)}
                        </td>
                        <td style={styles.td}>{fmtManwon(r.max)}</td>
                        <td style={styles.td}>{fmtManwon(r.min)}</td>
                        <td style={styles.td}>{fmtArea(r.avgArea)}</td>
                        <td style={styles.td}>{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
      ) : viewMode === 'subscriptions' ? (
      <div style={{ padding: '20px 20px 0' }}>
        <div style={styles.card} className="ui-card">
          <h2 style={styles.sectionTitle}>분양(청약) 정보</h2>
          <p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: '-6px 0 14px' }}>
            한국부동산원 청약홈 기준, 최근 1년 내 아파트 모집공고예요. 지역을 골라서 확인하세요.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ maxWidth: 220, flex: 1, minWidth: 160 }}>
              <select
                value={subsTabSido}
                onChange={(e) => setSubsTabSido(e.target.value)}
                style={{ ...styles.select, fontSize: 13 }}
              >
                {SIDO_SHORT_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={styles.toggleBtn(subsSubView === 'list')} onClick={() => setSubsSubView('list')}>분양공고 목록</div>
              <div style={styles.toggleBtn(subsSubView === 'supply')} onClick={() => setSubsSubView('supply')}>입주물량(공급)</div>
            </div>
          </div>
          {subsTabLoading && (
            <p style={{ fontSize: 12, color: PALETTE.textMuted }}>불러오는 중...</p>
          )}
          {!subsTabLoading && subsTabRows.length === 0 && (
            <p style={{ fontSize: 12, color: PALETTE.textMuted }}>최근 1년 내 모집공고가 없어요.</p>
          )}
          {subsSubView === 'supply' && subsTabRows.length > 0 && (
            <>
              <p style={{ fontSize: 11, color: PALETTE.textMuted, margin: '-6px 0 12px' }}>
                {subsTabSido} 지역, 입주예정월 기준 신규 공급 세대수예요. 아파트 청약 공고에 나온 세대수만 반영돼요.
              </p>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={supplyByMonth} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={PALETTE.border} vertical={false} />
                    <XAxis dataKey="ym" stroke={PALETTE.textMuted} fontSize={11} tickLine={false} />
                    <YAxis stroke={PALETTE.textMuted} fontSize={11} tickLine={false} width={44} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                      labelStyle={{ color: PALETTE.textPrimary }}
                      formatter={(v) => `${v.toLocaleString()}세대`} />
                    <Bar dataKey="세대수" fill={PALETTE.accent} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
          {subsSubView === 'list' && subsTabRows.length > 0 && (
            <div style={{ maxHeight: 520, overflowY: 'auto', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={styles.th}>주택명</th>
                    <th style={styles.th}>위치</th>
                    <th style={styles.th}>공급규모</th>
                    <th style={styles.th}>모집공고일</th>
                    <th style={styles.th}>청약접수</th>
                    <th style={styles.th}>입주예정</th>
                    <th style={styles.th}>시공사</th>
                    <th style={styles.th}>규제</th>
                  </tr>
                </thead>
                <tbody>
                  {subsTabRows.map((s, i) => (
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
                      <td style={styles.td}>{s.builder}</td>
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
          )}
        </div>
      </div>
      ) : viewMode === 'analytics' ? (
        <div style={{ padding: '20px 20px 40px', maxWidth: 1400, margin: '0 auto' }}>
          <div style={{ marginBottom: 18 }}>
            <h1 className="dash-title" style={{ ...styles.sectionTitle, fontSize: 26, marginBottom: 5 }}>순위·통계 분석</h1>
            <p style={{ fontSize: 12, color: PALETTE.textMuted, margin: 0 }}>현재 조회한 실거래 데이터를 기준으로 가격수준·변동률·거래량·가격범위를 비교합니다.</p>
          </div>
          <div style={{ ...styles.card, marginBottom: 14 }} className="ui-card">
            <label style={styles.label}>분석할 지역 추가</label>
            <select
              value={comparePickerValue}
              onChange={(e) => addRegionAndFetch(e.target.value)}
              style={{ ...styles.select, fontSize: 13, maxWidth: 320 }}
            >
              <option value="">시/도 - 시/군/구 선택</option>
              {REGION_GROUPS.map((g) => {
                const agg = SIDO_AGGREGATES.find((a) => a.sido === g.sido);
                return (
                  <optgroup key={g.sido} label={g.sido}>
                    {agg && <option key={agg.code} value={agg.code}>{agg.name}</option>}
                    {g.items.map((it) => (
                      <option key={it.code} value={it.code}>{it.name}</option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {selected.map((code) => (
                <span key={code} style={styles.chip}>
                  {labelFor(code)}
                  <X size={11} style={{ cursor: 'pointer' }} onClick={() => removeRegion(code)} />
                </span>
              ))}
              {selected.length === 0 && (
                <span style={{ fontSize: 12, color: PALETTE.textMuted }}>선택된 지역이 없어요. 위에서 지역을 추가해보세요.</span>
              )}
            </div>
            {status === 'loading' && (
              <p style={{ fontSize: 11.5, color: PALETTE.textMuted, marginTop: 8 }}>불러오는 중...</p>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 10, marginBottom: 14 }}>
            <div style={styles.card} className="ui-card"><div style={styles.kpiLabel}>분석 대상</div><div style={styles.kpiValue}>{analyticsKpis.count.toLocaleString()}개</div></div>
            <div style={styles.card} className="ui-card"><div style={styles.kpiLabel}>최근 평균 {unitLabel}</div><div style={styles.kpiValue}>{analyticsKpis.avg != null ? fmtWon(analyticsKpis.avg) : '-'}</div></div>
            <div style={styles.card} className="ui-card"><div style={styles.kpiLabel}>조회 거래량</div><div style={styles.kpiValue}>{analyticsKpis.volume.toLocaleString()}건</div></div>
            <div style={styles.card} className="ui-card"><div style={styles.kpiLabel}>변동률 중앙값</div><div style={styles.kpiValue}>{fmtPct(analyticsKpis.median)}</div></div>
          </div>
          <div style={{ ...styles.card, marginBottom: 14, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['region', '지역 분석'], ['complex', '단지 분석']].map(([k, l]) => (
                <button key={k} className="portal-pill" style={{ background: analyticsScope === k ? PALETTE.textPrimary : PALETTE.panelAlt, color: analyticsScope === k ? '#fff' : PALETTE.textPrimary }} onClick={() => setAnalyticsScope(k)}>{l}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[['change', '기간 변동률'], ['price', '가격수준'], ['volume', '거래량'], ['range', '가격범위']].map(([k, l]) => (
                <button key={k} className="portal-pill" style={{ background: analyticsMetric === k ? PALETTE.accent : PALETTE.panelAlt, color: analyticsMetric === k ? '#fff' : PALETTE.textPrimary }} onClick={() => setAnalyticsMetric(k)}>{l}</button>
              ))}
            </div>
          </div>
          <div style={styles.card} className="ui-card">
            <h2 style={styles.sectionTitle}>{analyticsScope === 'region' ? '지역별' : '단지별'} 분석 순위</h2>
            <p style={{ fontSize: 11, color: PALETTE.textMuted, margin: '-6px 0 12px' }}>선택한 지표를 기준으로 정렬한 수치 비교입니다.</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={styles.th}>순번</th>
                    <th style={styles.th}>{analyticsScope === 'region' ? '지역' : '단지'}</th>
                    <th style={styles.th}>최근 {unitLabel}</th>
                    <th style={styles.th}>기간 변동률</th>
                    <th style={styles.th}>거래량</th>
                    <th style={styles.th}>최저 거래가</th>
                    <th style={styles.th}>최고 거래가</th>
                  </tr>
                </thead>
                <tbody>
                  {analyticsSorted.map((r, i) => (
                    <tr key={r.key}>
                      <td style={styles.td}>{i + 1}</td>
                      <td
                        style={{ ...styles.td, color: analyticsScope === 'complex' ? PALETTE.accent : PALETTE.textPrimary, cursor: analyticsScope === 'complex' ? 'pointer' : 'default' }}
                        onClick={() => analyticsScope === 'complex' && setSelectedApt({ apt: r.apt, dong: r.dong, regionCode: r.regionCode })}
                      >
                        {r.name}
                        {r.sub && <div style={{ fontSize: 10, color: PALETTE.textMuted }}>{r.sub}</div>}
                      </td>
                      <td style={styles.td}>{r.latest != null ? fmtWon(r.latest) : '-'}</td>
                      <td style={{ ...styles.td, color: r.change > 0 ? PALETTE.up : r.change < 0 ? PALETTE.down : PALETTE.textSecondary }}>{fmtPct(r.change)}</td>
                      <td style={styles.td}>{r.volume.toLocaleString()}건</td>
                      <td style={styles.td}>{r.min != null ? fmtManwon(r.min) : '-'}</td>
                      <td style={styles.td}>{r.max != null ? fmtManwon(r.max) : '-'}</td>
                    </tr>
                  ))}
                  {analyticsSorted.length === 0 && (
                    <tr><td style={styles.td} colSpan={7}>분석할 데이터가 없습니다. 먼저 지역을 선택하고 조회해주세요.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : viewMode === 'market' ? (
      <div style={{ padding: '20px 20px 44px', maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ marginBottom: 18 }}>
          <h1 className="dash-title" style={{ ...styles.sectionTitle, fontSize: 26, marginBottom: 5 }}>시장분석센터</h1>
          <p style={{ fontSize: 12, color: PALETTE.textMuted, margin: 0 }}>현재 조회한 실거래를 바탕으로 가격·거래량·신고가·고점대비 하락폭을 한 화면에서 확인합니다.</p>
        </div>
        <div style={{ ...styles.card, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }} className="ui-card">
          <span style={{ fontSize: 12, fontWeight: 700 }}>분석기간</span>
          {['3', '6', '12'].map((v) => (
            <button key={v} className="portal-pill" onClick={() => setAnalyticsPeriod(v)} style={{ background: analyticsPeriod === v ? PALETTE.accent : PALETTE.panelAlt, color: analyticsPeriod === v ? '#fff' : PALETTE.textPrimary }}>{v}개월</button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: PALETTE.textMuted }}>조회 {advancedAnalytics.tx.length.toLocaleString()}건 · {advancedAnalytics.rows.length.toLocaleString()}개 단지</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 10, marginBottom: 12 }}>
          {[
            ['평균 최근가', advancedAnalytics.rows.length ? fmtWon(advancedAnalytics.rows.reduce((s, r) => s + r.latest, 0) / advancedAnalytics.rows.length) : '-'],
            ['거래량', `${advancedAnalytics.tx.length.toLocaleString()}건`],
            ['신고가 단지', `${advancedAnalytics.highs.length}개`],
            ['상승 모멘텀', advancedAnalytics.momentum[0] ? fmtPct(advancedAnalytics.momentum[0].mom) : '-'],
            ['최대 하락폭', advancedAnalytics.drawdowns[0] ? fmtPct(advancedAnalytics.drawdowns[0].drawdown) : '-'],
          ].map(([l, v]) => (
            <div key={l} style={styles.card} className="ui-card"><div style={styles.kpiLabel}>{l}</div><div style={{ ...styles.kpiValue, fontSize: 20 }}>{v}</div></div>
          ))}
        </div>
        <div style={{ ...styles.card, marginBottom: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }} className="ui-card">
          {[['overview', '요약'], ['compare', '가격비교'], ['momentum', '상승 모멘텀'], ['volume', '거래량'], ['highs', '신고가·하락'], ['distribution', '가격분포']].map(([k, l]) => (
            <button key={k} className="portal-pill" onClick={() => setAnalyticsView(k)} style={{ background: analyticsView === k ? PALETTE.textPrimary : PALETTE.panelAlt, color: analyticsView === k ? '#fff' : PALETTE.textPrimary }}>{l}</button>
          ))}
        </div>
        {analyticsView === 'overview' && (
          <>
            <div style={{ ...styles.card, marginBottom: 12 }} className="ui-card">
              <h2 style={styles.sectionTitle}>월별 거래량</h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={advancedAnalytics.monthSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="ym" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="건수" fill={PALETTE.accent} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={styles.card} className="ui-card">
                <h2 style={styles.sectionTitle}>최근 상승 모멘텀</h2>
                {advancedAnalytics.momentum.slice(0, 8).map((r) => (
                  <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: `1px solid ${PALETTE.border}`, cursor: 'pointer' }} onClick={() => setSelectedApt({ apt: r.apt, dong: r.dong, regionCode: r.regionCode })}>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{r.apt}<small style={{ display: 'block', color: PALETTE.textMuted, fontWeight: 400 }}>{r.dong}</small></span>
                    <b style={{ color: r.mom >= 0 ? PALETTE.up : PALETTE.down }}>{fmtPct(r.mom)}</b>
                  </div>
                ))}
              </div>
              <div style={styles.card} className="ui-card">
                <h2 style={styles.sectionTitle}>고점 대비 하락</h2>
                {advancedAnalytics.drawdowns.slice(0, 8).map((r) => (
                  <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: `1px solid ${PALETTE.border}`, cursor: 'pointer' }} onClick={() => setSelectedApt({ apt: r.apt, dong: r.dong, regionCode: r.regionCode })}>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{r.apt}<small style={{ display: 'block', color: PALETTE.textMuted, fontWeight: 400 }}>{r.dong}</small></span>
                    <b style={{ color: PALETTE.down }}>{fmtPct(r.drawdown)}</b>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
        {analyticsView === 'compare' && (
          <div style={styles.card} className="ui-card">
            <h2 style={styles.sectionTitle}>단지 가격비교</h2>
            <p style={{ fontSize: 11, color: PALETTE.textMuted }}>최근 거래가와 기간 변동, 거래량을 동시에 비교합니다.</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['단지', '최근가', '평당가', '변동률', '거래량', '고점대비'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {advancedAnalytics.rows.slice().sort((a, b) => (b.unitPrice ?? b.latest) - (a.unitPrice ?? a.latest)).slice(0, 80).map((r) => (
                    <tr key={r.key}>
                      <td style={{ ...styles.td, color: PALETTE.accent, cursor: 'pointer' }} onClick={() => setSelectedApt({ apt: r.apt, dong: r.dong, regionCode: r.regionCode })}>{r.apt}<div style={{ fontSize: 10, color: PALETTE.textMuted }}>{r.dong}</div></td>
                      <td style={styles.td}>{fmtWon(r.latest)}</td>
                      <td style={styles.td}>{r.unitPrice ? fmtManwon(r.unitPrice) : '-'}</td>
                      <td style={{ ...styles.td, color: r.change >= 0 ? PALETTE.up : PALETTE.down }}>{fmtPct(r.change)}</td>
                      <td style={styles.td}>{r.volume}건</td>
                      <td style={{ ...styles.td, color: r.drawdown < 0 ? PALETTE.down : PALETTE.textSecondary }}>{fmtPct(r.drawdown)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {analyticsView === 'momentum' && (
          <div style={styles.card} className="ui-card">
            <h2 style={styles.sectionTitle}>최근 거래 모멘텀</h2>
            <p style={{ fontSize: 11, color: PALETTE.textMuted }}>선택 기간 내 마지막 두 거래의 가격 차이를 계산한 지표입니다. 거래 간 면적 차이는 보정하지 않습니다.</p>
            {advancedAnalytics.momentum.map((r, i) => (
              <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '42px 1fr 100px 90px', gap: 8, padding: '11px 0', borderBottom: `1px solid ${PALETTE.border}`, alignItems: 'center' }}>
                <b>{i + 1}</b>
                <span style={{ fontSize: 12, fontWeight: 700, cursor: 'pointer' }} onClick={() => setSelectedApt({ apt: r.apt, dong: r.dong, regionCode: r.regionCode })}>{r.apt}<small style={{ display: 'block', fontWeight: 400, color: PALETTE.textMuted }}>{r.dong}</small></span>
                <span>{fmtWon(r.latest)}</span>
                <b style={{ color: r.mom >= 0 ? PALETTE.up : PALETTE.down }}>{fmtPct(r.mom)}</b>
              </div>
            ))}
          </div>
        )}
        {analyticsView === 'volume' && (
          <div style={styles.card} className="ui-card">
            <h2 style={styles.sectionTitle}>거래량 상위 단지</h2>
            {advancedAnalytics.volumeLeaders.map((r, i) => (
              <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '42px 1fr 90px 90px', gap: 8, padding: '11px 0', borderBottom: `1px solid ${PALETTE.border}` }}>
                <b>{i + 1}</b>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{r.apt}<small style={{ display: 'block', fontWeight: 400, color: PALETTE.textMuted }}>{r.dong}</small></span>
                <span>{r.volume}건</span>
                <span>{fmtWon(r.latest)}</span>
              </div>
            ))}
          </div>
        )}
        {analyticsView === 'distribution' && (() => {
          const vals = advancedAnalytics.rows.map((r) => r.latest).filter((v) => Number.isFinite(v));
          if (!vals.length) return <div style={styles.card} className="ui-card">가격분포를 계산할 데이터가 없습니다.</div>;
          const min = Math.floor(Math.min(...vals) / 10000) * 10000;
          const max = Math.ceil(Math.max(...vals) / 10000) * 10000;
          const step = 10000;
          const bins = [];
          for (let lo = min; lo <= max; lo += step) {
            const hi = lo + step;
            bins.push({ label: `${(lo / 10000).toFixed(0)}억`, count: vals.filter((v) => v >= lo && v < hi).length });
          }
          const top = Math.max(...bins.map((b) => b.count), 1);
          return (
            <div style={styles.card} className="ui-card">
              <h2 style={styles.sectionTitle}>최근 거래가격 분포</h2>
              <p style={{ fontSize: 11, color: PALETTE.textMuted }}>현재 조회된 단지의 최근 거래가격을 1억원 구간으로 나눠 분포를 보여줍니다.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: 8, alignItems: 'end' }}>
                {bins.map((b) => (
                  <div key={b.label} style={{ textAlign: 'center' }}>
                    <div style={{ height: 110, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                      <div title={`${b.count}건`} style={{ width: '55%', height: `${Math.max(4, (b.count / top) * 100)}%`, background: PALETTE.accent, borderRadius: '5px 5px 0 0' }} />
                    </div>
                    <b style={{ fontSize: 11 }}>{b.label}</b>
                    <div style={{ fontSize: 10, color: PALETTE.textMuted }}>{b.count}개</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
        {analyticsView === 'highs' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={styles.card} className="ui-card">
              <h2 style={styles.sectionTitle}>신고가 후보</h2>
              {advancedAnalytics.highs.map((r) => (
                <div key={r.key} style={{ padding: '10px 0', borderBottom: `1px solid ${PALETTE.border}` }}>
                  <b>{r.apt}</b><span style={{ float: 'right', color: PALETTE.up }}>{fmtWon(r.latest)}</span>
                  <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>{r.dong} · 최고가 갱신</div>
                </div>
              ))}
            </div>
            <div style={styles.card} className="ui-card">
              <h2 style={styles.sectionTitle}>고점 대비 하락폭</h2>
              {advancedAnalytics.drawdowns.map((r) => (
                <div key={r.key} style={{ padding: '10px 0', borderBottom: `1px solid ${PALETTE.border}` }}>
                  <b>{r.apt}</b><span style={{ float: 'right', color: PALETTE.down }}>{fmtPct(r.drawdown)}</span>
                  <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>{r.dong} · 현재 {fmtWon(r.latest)} / 고점 {fmtWon(r.high)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ fontSize: 10.5, color: PALETTE.textMuted, marginTop: 12 }}>※ 모든 지표는 현재 화면에서 조회된 실거래를 기반으로 한 파생지표입니다. 면적·층·동일 평형 여부를 완전히 보정하지 않은 값은 참고용으로 표시합니다.</div>
      </div>
      ) : viewMode === 'favorites' ? (
      <div style={{ padding: '20px 20px 0' }}>
        <div style={styles.card} className="ui-card">
          <h2 style={styles.sectionTitle}>즐겨찾기</h2>
          <p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: '-6px 0 14px' }}>
            저장해둔 조건 조합이에요. 클릭 한 번으로 그 설정 그대로 불러올 수 있어요.
          </p>
          {favorites.length === 0 ? (
            <p style={{ fontSize: 13, color: PALETTE.textMuted }}>
              아직 저장된 즐겨찾기가 없어요. 대시보드 탭 왼쪽 패널에서 조건을 설정한 뒤 이름을 붙여 저장해보세요.
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
              {favorites.map((fav) => (
                <div
                  key={fav.name}
                  style={{
                    ...styles.card, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8,
                  }}
                  className="ui-card"
                  onClick={() => { applyFavorite(fav); setViewMode('normal'); }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{fav.name}</span>
                    <X
                      size={14}
                      color={PALETTE.textMuted}
                      style={{ cursor: 'pointer', flexShrink: 0 }}
                      onClick={(e) => { e.stopPropagation(); removeFavorite(fav.name); }}
                    />
                  </div>
                  <div style={{ fontSize: 12, color: PALETTE.textSecondary }}>
                    {{ trade: '매매', rent: '전월세', rone: '시세동향', ratio: '전세가율', silv: '분양권전매' }[fav.dealType] || fav.dealType}
                    {' · '}
                    {fav.startYm ? `${monthLabel(fav.startYm)} ~ ${monthLabel(fav.endYm)}` : ''}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {fav.selected.slice(0, 4).map((code) => (
                      <span key={code} style={{ ...styles.chip, padding: '2px 8px', fontSize: 10.5 }}>{labelFor(code)}</span>
                    ))}
                    {fav.selected.length > 4 && (
                      <span style={{ fontSize: 10.5, color: PALETTE.textMuted }}>+{fav.selected.length - 4}개 더</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ ...styles.card, marginTop: 16 }} className="ui-card">
          <h2 style={styles.sectionTitle}>가격 알림</h2>
          <p style={{ fontSize: 11.5, color: PALETTE.textMuted, margin: '-6px 0 14px' }}>
            단지 상세 화면에서 등록한 알림이에요. 매일 자동으로 확인해서 조건을 만족하면 알려드려요.
          </p>
          {userAlerts.length === 0 ? (
            <p style={{ fontSize: 13, color: PALETTE.textMuted }}>
              등록된 알림이 없어요. 지도에서 단지를 클릭한 뒤 "🔔 이 단지 가격 알림 등록"을 눌러보세요.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {userAlerts.map((a) => (
                <div key={a.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: PALETTE.panelAlt, borderRadius: 10, padding: '10px 12px',
                }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{a.apt} <span style={{ fontWeight: 400, color: PALETTE.textMuted, fontSize: 11 }}>({a.regionName} {a.dong})</span></div>
                    <div style={{ fontSize: 12, color: PALETTE.textSecondary, marginTop: 2 }}>
                      {fmtManwon(a.targetPrice)} {a.direction === 'above' ? '이상' : '이하'}
                      {a.firedAt && <span style={{ color: PALETTE.up, marginLeft: 6 }}>✓ 알림 발송됨</span>}
                    </div>
                  </div>
                  <X size={14} color={PALETTE.textMuted} style={{ cursor: 'pointer' }} onClick={() => removeUserAlert(a.id)} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
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
                      </tr>
                    ))}
                    {complexCompare.length === 0 && (
                      <tr><td style={styles.td} colSpan={9}>비교할 단지가 없습니다.</td></tr>
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
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(30,28,24,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
          }}
          onClick={() => setSelectedApt(null)}
        >
          <div
            style={{
              background: PALETTE.panel, borderRadius: 18, padding: 20, width: '100%', maxWidth: 640,
              maxHeight: '80vh', overflowY: 'auto', border: `1px solid ${PALETTE.border}`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <h2 style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em', margin: 0 }}>
                {selectedApt.apt} ({selectedApt.dong})
              </h2>
              <X size={18} style={{ cursor: 'pointer', color: PALETTE.textMuted }} onClick={() => setSelectedApt(null)} />
            </div>
            <p style={{ fontSize: 12, color: PALETTE.textMuted, margin: '0 0 14px' }}>
              {labelFor(selectedApt.regionCode)} · 전체 기간(최대 20년) 실거래 내역 {aptHistoryLoading ? '불러오는 중...' : `${aptHistory.length}건`}
              {isRatio || isRone ? '' : ` (${isRent ? '전월세' : '매매'} 기준)`}
            </p>
            {aptSummary && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
                <div style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: '8px 10px' }}>
                  <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>최근 3개월 평균</div>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>{aptSummary.recentAvg != null ? fmtManwon(aptSummary.recentAvg) : '-'}</div>
                  <div style={{ fontSize: 10, color: PALETTE.textMuted }}>거래 {aptSummary.recentCount}건</div>
                </div>
                <div style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: '8px 10px' }}>
                  <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>1년 전 대비</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: aptSummary.yoyChange > 0 ? PALETTE.up : aptSummary.yoyChange < 0 ? PALETTE.down : PALETTE.textPrimary }}>
                    {aptSummary.yoyChange != null ? fmtPct(aptSummary.yoyChange) : '-'}
                  </div>
                  <div style={{ fontSize: 10, color: PALETTE.textMuted }}>
                    {aptSummary.yearAgoAvg != null ? `1년 전 평균 ${fmtManwon(aptSummary.yearAgoAvg)}` : '비교 기준 없음'}
                  </div>
                </div>
                <div style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: '8px 10px' }}>
                  <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>3년 내 최고가</div>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>{aptSummary.maxPrice != null ? fmtManwon(aptSummary.maxPrice) : '-'}</div>
                  <div style={{ fontSize: 10, color: PALETTE.textMuted }}>{aptSummary.maxLabel}</div>
                </div>
              </div>
            )}
            {!isRent && !isRatio && !isRone && aptSummary?.recentAvg != null && (() => {
              const price = calcPriceInput !== '' ? parseFloat(calcPriceInput) * 10000 : aptSummary.recentAvg;
              const tax = calcAcquisitionTax(price);
              const loan = calcLoanEstimate(price, isRegulatedByCode(selectedApt.regionCode));
              return (
                <div style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: 12, marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700 }}>취득세·대출 계산기 (참고용)</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="number"
                        placeholder={String(Math.round(aptSummary.recentAvg / 10000))}
                        value={calcPriceInput}
                        onChange={(e) => setCalcPriceInput(e.target.value)}
                        style={{
                          width: 80, padding: '4px 6px', borderRadius: 6, border: `1px solid ${PALETTE.border}`,
                          fontSize: 12, textAlign: 'right',
                        }}
                      />
                      <span style={{ fontSize: 11, color: PALETTE.textMuted }}>억원 기준</span>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>취득세 등 합계 (1주택 기준)</div>
                      <div style={{ fontSize: 15, fontWeight: 800 }}>{tax ? fmtManwon(tax.total) : '-'}</div>
                      <div style={{ fontSize: 10, color: PALETTE.textMuted }}>취득세율 약 {tax ? tax.rate.toFixed(2) : '-'}%</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, color: PALETTE.textMuted }}>추정 대출 가능액 (LTV 기준)</div>
                      <div style={{ fontSize: 15, fontWeight: 800 }}>{loan ? fmtManwon(loan.maxLoan) : '-'}</div>
                      <div style={{ fontSize: 10, color: PALETTE.textMuted }}>LTV {loan ? Math.round(loan.ltv * 100) : '-'}% ({isRegulatedByCode(selectedApt.regionCode) ? '규제지역' : '비규제지역'})</div>
                    </div>
                  </div>
                  <p style={{ fontSize: 9.5, color: PALETTE.textMuted, margin: '8px 0 0' }}>
                    다주택 중과·생애최초 감면·DSR·소득 등은 반영되지 않은 단순 참고용 추정치예요. 실제 세액·대출한도는 세무사·은행 확인이 필요해요.
                  </p>
                </div>
              );
            })()}
            {gongsiLoading && (
              <p style={{ fontSize: 11, color: PALETTE.textMuted, marginBottom: 10 }}>공시가격 조회 중...</p>
            )}
            {gongsiInfo?.rows?.length > 0 && (
              <div style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: 12, marginBottom: 14 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>공동주택 공시가격 (브이월드)</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {gongsiInfo.rows.slice(0, 6).map((r, i) => (
                    <span key={i} style={styles.chip}>
                      {r.dong}동 {r.ho}호 · {fmtManwon(Math.round(r.price / 10000))} ({r.year}년)
                    </span>
                  ))}
                </div>
              </div>
            )}
            {(aptBasicInfo || nearestStationInfo || isRegulatedByCode(selectedApt.regionCode)) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {isRegulatedByCode(selectedApt.regionCode) && (
                  <span style={{ ...styles.chip, background: 'rgba(239,68,68,0.12)', borderColor: PALETTE.accent }}>
                    규제지역(투기과열지구·조정대상지역)
                  </span>
                )}
                {aptBasicInfo?.households && <span style={styles.chip}>세대수 {aptBasicInfo.households}</span>}
                {aptBasicInfo?.dongCount && <span style={styles.chip}>{aptBasicInfo.dongCount}개동</span>}
                {aptBasicInfo?.useDate && <span style={styles.chip}>준공 {String(aptBasicInfo.useDate).slice(0, 4)}년</span>}
                {aptBasicInfo?.builder && <span style={styles.chip}>시공 {aptBasicInfo.builder}</span>}
                {nearestStationInfo && (
                  <span style={styles.chip}>
                    {nearestStationInfo.name}역({nearestStationInfo.line}) 도보 {nearestStationInfo.walkMin}분
                  </span>
                )}
              </div>
            )}
            <div style={{ marginBottom: 14 }}>
              {!alertFormOpen ? (
                <button className="ui-btn" style={{ ...styles.btn, width: 'auto', padding: '7px 12px', fontSize: 12 }} onClick={() => setAlertFormOpen(true)}>
                  🔔 이 단지 가격 알림 등록
                </button>
              ) : (
                <div style={{ background: PALETTE.panelAlt, borderRadius: 10, padding: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <select value={alertDirection} onChange={(e) => setAlertDirection(e.target.value)} style={{ ...styles.select, width: 'auto', fontSize: 12 }}>
                    <option value="below">이하로 떨어지면</option>
                    <option value="above">이상으로 오르면</option>
                  </select>
                  <input
                    type="number"
                    placeholder="목표가(억원)"
                    value={alertTargetPrice}
                    onChange={(e) => setAlertTargetPrice(e.target.value)}
                    style={{ width: 100, padding: '6px 8px', borderRadius: 6, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                  />
                  <button className="ui-btn" style={{ ...styles.btn, width: 'auto', padding: '6px 12px', fontSize: 12 }} onClick={submitAlert} disabled={alertSaving}>
                    {alertSaving ? '등록 중...' : '등록'}
                  </button>
                  <span style={{ fontSize: 11, color: PALETTE.textMuted, cursor: 'pointer' }} onClick={() => setAlertFormOpen(false)}>취소</span>
                </div>
              )}
              <p style={{ fontSize: 9.5, color: PALETTE.textMuted, margin: '4px 0 0' }}>
                등록한 알림은 "즐겨찾기" 탭에서 관리할 수 있어요. 매일 자동으로 확인해서 조건을 만족하면 알려드려요.
              </p>
            </div>
            {schoolsLoading && nearbySchools.length === 0 && (
              <p style={{ fontSize: 11, color: PALETTE.textMuted, marginBottom: 10 }}>인근 학교 찾는 중...</p>
            )}
            {nearbySchools.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {nearbySchools.map((s) => (
                  <span key={s.name} style={styles.chip}>{s.name} ({s.kind}{s.foundType ? `·${s.foundType}` : ''})</span>
                ))}
              </div>
            )}
            {aptHistoryAreaOptions.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: PALETTE.textMuted }}>평형대</span>
                <button
                  onClick={() => setHistoryAreaFilter('all')}
                  style={{
                    border: `1px solid ${historyAreaFilter === 'all' ? PALETTE.accent : PALETTE.border}`,
                    background: historyAreaFilter === 'all' ? 'rgba(239,68,68,0.10)' : 'transparent',
                    color: historyAreaFilter === 'all' ? PALETTE.up : PALETTE.textSecondary,
                    borderRadius: 8, padding: '3px 8px', fontSize: 11, cursor: 'pointer',
                  }}
                >
                  전체
                </button>
                {aptHistoryAreaOptions.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => setHistoryAreaFilter(o.value)}
                    style={{
                      border: `1px solid ${historyAreaFilter === o.value ? PALETTE.accent : PALETTE.border}`,
                      background: historyAreaFilter === o.value ? 'rgba(239,68,68,0.10)' : 'transparent',
                      color: historyAreaFilter === o.value ? PALETTE.up : PALETTE.textSecondary,
                      borderRadius: 8, padding: '3px 8px', fontSize: 11, cursor: 'pointer',
                    }}
                  >
                    {o.label} ({o.count})
                  </button>
                ))}
              </div>
            )}
            {aptTrendData.length > 1 && (
              <div style={{ width: '100%', height: 160, marginBottom: 16 }}>
                <ResponsiveContainer>
                  <LineChart data={aptTrendData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={PALETTE.border} vertical={false} />
                    <XAxis dataKey="ym" stroke={PALETTE.textMuted} fontSize={10} tickLine={false} />
                    <YAxis stroke={PALETTE.textMuted} fontSize={10} tickLine={false} width={46} />
                    <Tooltip
                      contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                      labelStyle={{ color: PALETTE.textPrimary }}
                      formatter={(v) => `${v.toLocaleString()}만원`}
                    />
                    <Line type="monotone" dataKey="가격" stroke={PALETTE.accent} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {aptVolumeData.length > 1 && (
              <div style={{ width: '100%', height: 90, marginBottom: 16 }}>
                <ResponsiveContainer>
                  <BarChart data={aptVolumeData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <XAxis dataKey="ym" stroke={PALETTE.textMuted} fontSize={10} tickLine={false} />
                    <YAxis stroke={PALETTE.textMuted} fontSize={10} tickLine={false} width={30} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                      labelStyle={{ color: PALETTE.textPrimary }}
                      formatter={(v) => `${v}건`}
                    />
                    <Bar dataKey="건수" fill={PALETTE.down} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <p style={{ fontSize: 10.5, color: PALETTE.textMuted, margin: '2px 0 0', textAlign: 'center' }}>월별 거래건수</p>
              </div>
            )}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
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
                  {aptHistoryFiltered.map((t, i) => (
                    <tr key={i}>
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
                  {aptHistoryFiltered.length === 0 && (
                    <tr><td style={styles.td} colSpan={isRent ? 7 : 5}>표시할 거래 내역이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <style>{`
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

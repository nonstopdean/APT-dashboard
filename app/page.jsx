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
import { REGION_GROUPS, regionLabel, SIDO_AGGREGATES, isSidoAggregate, expandRegionCode } from '../lib/regions';
import { SIDO_REGIONS, roneRegionLabel } from '../lib/rone-regions';

const RONE_ONLY_EXTRA = SIDO_REGIONS.filter((r) => ['90001', '90002', '90003'].includes(r.code));

const DEFAULT_SELECTED = [];
const LINE_COLORS = ['#C79A46', '#5B8AA6', '#B85C4A', '#6B8F5E', '#8B7EC8', '#C4763A'];

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
  const isRent = dealType === 'rent';
  const isRone = dealType === 'rone';
  const isRatio = dealType === 'ratio';
  const [panelOpen, setPanelOpen] = useState(true);
  const [viewMode, setViewMode] = useState('normal'); // 'normal' | 'map'
  const [panelPos, setPanelPos] = useState({ top: 16, left: 16 });
  const panelRef = useRef(null);
  const dragRef = useRef(null);
  const rafRef = useRef(null);

  const applyDragFrame = () => {
    rafRef.current = null;
    if (!dragRef.current || !panelRef.current) return;
    panelRef.current.style.top = `${dragRef.current.curTop}px`;
    panelRef.current.style.left = `${dragRef.current.curLeft}px`;
  };
  const handleDragMove = (e) => {
    if (!dragRef.current) return;
    const point = e.touches ? e.touches[0] : e;
    const dx = point.clientX - dragRef.current.startX;
    const dy = point.clientY - dragRef.current.startY;
    dragRef.current.curTop = Math.max(0, dragRef.current.origTop + dy);
    dragRef.current.curLeft = Math.max(0, dragRef.current.origLeft + dx);
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(applyDragFrame);
    if (e.touches) e.preventDefault();
  };
  const handleDragEnd = () => {
    if (dragRef.current) {
      setPanelPos({ top: dragRef.current.curTop, left: dragRef.current.curLeft });
    }
    dragRef.current = null;
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    window.removeEventListener('mousemove', handleDragMove);
    window.removeEventListener('mouseup', handleDragEnd);
    window.removeEventListener('touchmove', handleDragMove);
    window.removeEventListener('touchend', handleDragEnd);
  };
  const handleDragStart = (e) => {
    const point = e.touches ? e.touches[0] : e;
    dragRef.current = {
      startX: point.clientX, startY: point.clientY,
      origTop: panelPos.top, origLeft: panelPos.left,
      curTop: panelPos.top, curLeft: panelPos.left,
    };
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
    window.addEventListener('touchmove', handleDragMove, { passive: false });
    window.addEventListener('touchend', handleDragEnd);
  };
  const [startYm, setStartYm] = useState(ymShift(ymNow(), -5));
  const [endYm, setEndYm] = useState(ymNow());
  const [selected, setSelected] = useState(DEFAULT_SELECTED);
  const [pickerValue, setPickerValue] = useState('');
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
    setPickerValue('');
  };
  const removeRegion = (code) => {
    setSelected((prev) => prev.filter((c) => c !== code));
  };
  const [comparePickerValue, setComparePickerValue] = useState('');
  const addRegionAndFetch = (code) => {
    if (!code) return;
    setComparePickerValue('');
    if (selected.includes(code)) return;
    const next = [...selected, code];
    setSelected(next);
    handleFetch(next);
  };

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
        return;
      }
      if (dealType === 'ratio') {
        const [saleRes, rentRes] = await Promise.all([
          fetch(`/api/trades?codes=${codesToUse.join(',')}&start=${startYm}&end=${endYm}`),
          fetch(`/api/rents?codes=${codesToUse.join(',')}&start=${startYm}&end=${endYm}`),
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
        setFetchedAt(new Date());
        const combinedError = saleJson.error || rentJson.error;
        if (combinedError) setErrorMsg(`일부 항목에서 오류: ${combinedError}`);
        setStatus('done');
        return;
      }
      const endpoint = dealType === 'rent' ? '/api/rents' : '/api/trades';
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
    return all;
  }, [selected, months, rawByRegionMonth]);

  const recentTx = useMemo(() => allTx.slice(0, 30), [allTx]);

  const aptHistory = useMemo(() => {
    if (!selectedApt) return [];
    return allTx.filter((t) => t.apt === selectedApt.apt && t.dong === selectedApt.dong && t.regionCode === selectedApt.regionCode);
  }, [allTx, selectedApt]);

  const aptTrendData = useMemo(() => {
    const byMonth = {};
    aptHistory.forEach((t) => {
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
  }, [aptHistory, isRent]);

  // 단지별로 묶어서, 가장 최근 거래 기준으로 여러 단지를 한눈에 비교할 수 있는 목록.
  // 평당가(또는 전세는 보증금 평당가) 기준으로 정렬해서, 값이 비슷한 단지끼리 자연스럽게 이웃하게 둔다.
  const complexCompare = useMemo(() => {
    const groups = {};
    allTx.forEach((t) => {
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
      const unitPrice = isRent
        ? (latest.isJeonse ? latest.depositPerPyeong : null)
        : latest.pricePerPyeong;
      return { ...latest, count: rows.length, unitPrice };
    });
    return list
      .filter((r) => r.unitPrice != null)
      .sort((a, b) => a.unitPrice - b.unitPrice);
  }, [allTx, isRent]);

  const mapComplexes = useMemo(() => {
    const seen = new Set();
    const list = [];
    allTx.forEach((t) => {
      const key = `${t.regionCode}|${t.dong}|${t.apt}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ key, apt: t.apt, dong: t.dong, regionCode: t.regionCode, regionName: regionLabel(t.regionCode) });
    });
    return list;
  }, [allTx]);

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

  const [drillSido, setDrillSido] = useState('');
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

  const handleDrillSelectRegion = (code) => {
    if (!code) return;
    addRegion(code);
    if (codeToLatLng[code]) setFocusLatLng(codeToLatLng[code]);
  };

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
            onSelect={(code) => addRegion(code)}
            focusLatLng={focusLatLng}
            height="100%"
          />
        ) : process.env.NEXT_PUBLIC_KAKAO_MAP_KEY ? (
          <KakaoChoropleth
            features={seoulMapData.features}
            values={seoulMapData.values}
            colorFor={colorFor}
            borderColor={PALETTE.border}
            onSelect={(code) => addRegion(code)}
            focusLatLng={focusLatLng}
            complexes={mapComplexes}
            onComplexSelect={(c) => setSelectedApt({ apt: c.apt, dong: c.dong, regionCode: c.regionCode })}
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
                  onClick={() => f.code && addRegion(f.code)}
                >
                  <title>{f.name}{value != null ? `: ${Math.round(value).toLocaleString()}` : ' (데이터 없음)'}</title>
                </path>
              );
            })}
          </svg>
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
              cursor: viewMode === 'map' ? 'move' : 'default', userSelect: 'none',
            }}
            onMouseDown={viewMode === 'map' ? handleDragStart : undefined}
            onTouchStart={viewMode === 'map' ? handleDragStart : undefined}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            <div style={styles.toggleBtn(dealType === 'trade')} onClick={() => setDealTypeSafe('trade')}>매매</div>
            <div style={styles.toggleBtn(dealType === 'rent')} onClick={() => setDealTypeSafe('rent')}>전월세</div>
            <div style={styles.toggleBtn(dealType === 'rone')} onClick={() => setDealTypeSafe('rone')}>시세동향</div>
            <div style={styles.toggleBtn(dealType === 'ratio')} onClick={() => setDealTypeSafe('ratio')}>전세가율</div>
          </div>
          {isRone && (
            <p style={{ fontSize: 10.5, color: PALETTE.textMuted, marginTop: 6 }}>
              한국부동산원 전국주택가격동향조사 기준 (실거래와 별도 통계, 표본조사)
            </p>
          )}
        </div>

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
          <label style={styles.label}>지역 추가 (전국)</label>
          <select style={styles.select} value={pickerValue} onChange={(e) => addRegion(e.target.value)}>
            <option value="">시/도 - 시/군/구 선택</option>
            <optgroup label="시/도 전체 (합산)">
              {SIDO_AGGREGATES.map((it) => (
                <option key={it.code} value={it.code}>{it.name}</option>
              ))}
            </optgroup>
            {isRone && (
              <optgroup label="광역 통계 (한국부동산원)">
                {RONE_ONLY_EXTRA.map((it) => (
                  <option key={it.code} value={it.code}>{it.name}</option>
                ))}
              </optgroup>
            )}
            {REGION_GROUPS.map((g) => (
              <optgroup key={g.sido} label={g.sido}>
                {g.items.map((it) => (
                  <option key={it.code} value={it.code}>{it.name}</option>
                ))}
              </optgroup>
            ))}
          </select>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, maxHeight: 180, overflowY: 'auto' }}>
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
        position: 'sticky', top: 0, zIndex: 200, display: 'flex', gap: 8,
        padding: '10px 16px', background: PALETTE.panel, borderBottom: `1px solid ${PALETTE.border}`,
        boxShadow: '0 2px 8px rgba(33,31,26,0.05)',
      }}>
        <div
          onClick={() => setViewMode('normal')}
          style={{ ...styles.toggleBtn(viewMode === 'normal'), padding: '6px 16px', width: 'auto' }}
        >
          대시보드
        </div>
        <div
          onClick={() => setViewMode('map')}
          style={{ ...styles.toggleBtn(viewMode === 'map'), padding: '6px 16px', width: 'auto' }}
        >
          지도
        </div>
        <div
          onClick={() => setViewMode('compare')}
          style={{ ...styles.toggleBtn(viewMode === 'compare'), padding: '6px 16px', width: 'auto' }}
        >
          비교분석
        </div>
      </div>

      {viewMode === 'map' ? (
      <div className="hero-wrap" style={{ position: 'relative', width: '100%', height: '100vh', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, touchAction: 'none' }}>
          {renderSeoulMap()}
        </div>

        <div className="drill-select-bar" style={{
          position: 'fixed', top: 66, left: '50%', transform: 'translateX(-50%)', zIndex: 900,
          display: 'flex', gap: 6, background: PALETTE.panel, border: `1px solid ${PALETTE.border}`,
          borderRadius: 10, padding: 8, boxShadow: '0 6px 18px rgba(20,18,14,0.18)',
        }}>
          <select
            value={drillSido}
            onChange={(e) => setDrillSido(e.target.value)}
            style={{ ...styles.select, padding: '6px 8px', fontSize: 12, width: 140 }}
          >
            <option value="">시/도 선택</option>
            {REGION_GROUPS.map((g) => <option key={g.sido} value={g.sido}>{g.sido}</option>)}
          </select>
          <select
            value=""
            onChange={(e) => handleDrillSelectRegion(e.target.value)}
            disabled={!drillSido}
            style={{ ...styles.select, padding: '6px 8px', fontSize: 12, width: 140 }}
          >
            <option value="">시/군/구 선택</option>
            {(REGION_GROUPS.find((g) => g.sido === drillSido)?.items || []).map((it) => (
              <option key={it.code} value={it.code}>{it.name}</option>
            ))}
          </select>
        </div>

        {!panelOpen && (
          <button
            onClick={() => setPanelOpen(true)}
            style={{
              position: 'fixed', top: panelPos.top, left: panelPos.left, width: 40, height: 40, borderRadius: '50%',
              background: PALETTE.panel, border: `1px solid ${PALETTE.border}`, boxShadow: '0 6px 18px rgba(20,18,14,0.22)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 1000,
            }}
            aria-label="패널 펼치기"
          >
            <ChevronRight size={18} color={PALETTE.textPrimary} />
          </button>
        )}

        {panelOpen && (
        <aside
          ref={panelRef}
          style={{
            ...styles.sidebar,
            position: 'fixed', top: panelPos.top, left: panelPos.left, width: 300,
            maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
            borderRadius: 16, borderRight: 'none', border: `1px solid ${PALETTE.border}`,
            boxShadow: '0 10px 34px rgba(20,18,14,0.22)', zIndex: 1000,
          }}
          className="dash-sidebar-float"
        >
          {sidebarInner}
      </aside>
        )}
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
              <optgroup label="시/도 전체 (합산)">
                {SIDO_AGGREGATES.map((it) => (
                  <option key={it.code} value={it.code}>{it.name}</option>
                ))}
              </optgroup>
              {REGION_GROUPS.map((g) => (
                <optgroup key={g.sido} label={g.sido}>
                  {g.items.map((it) => (
                    <option key={it.code} value={it.code}>{it.name}</option>
                  ))}
                </optgroup>
              ))}
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

      {viewMode !== 'compare' && (
      <main style={styles.main} className="dash-main">
        <div>
          <h1 className="dash-title" style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 4px' }}>
            선택 지역 아파트 {isRatio ? '전세가율' : isRone ? '시세동향' : isRent ? '전월세' : '매매'} 시황
          </h1>
          <p style={{ fontSize: 12.5, color: PALETTE.textMuted, margin: 0 }}>
            {fetchedAt
              ? `${fetchedAt.toLocaleString('ko-KR')} 기준 · 실거래 신고 특성상 최근 1~2개월 데이터는 계속 채워지는 중일 수 있습니다.`
              : '왼쪽에서 조건을 설정한 뒤 데이터 조회를 눌러주세요.'}
          </p>
        </div>

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
                  {roneKpis.avg != null ? `${Math.round(roneKpis.avg).toLocaleString()}${roneKpis.unit || '만원'}` : '-'}
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
              <h2 style={styles.sectionTitle}>평균매매가격 추이 (한국부동산원)</h2>
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <LineChart data={roneChartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={PALETTE.border} vertical={false} />
                    <XAxis dataKey="ym" stroke={PALETTE.textMuted} fontSize={11} tickLine={false} />
                    <YAxis stroke={PALETTE.textMuted} fontSize={11} tickLine={false} width={48} />
                    <Tooltip contentStyle={{ background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`, fontSize: 12 }}
                      labelStyle={{ color: PALETTE.textPrimary }} />
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
                        {r.unsupported ? '미지원' : r.latest != null ? `${Math.round(r.latest).toLocaleString()}${r.unit || '만원'}` : '-'}
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
              <h2 style={styles.sectionTitle}>단지별 비교</h2>
              <p style={{ fontSize: 11, color: PALETTE.textMuted, margin: '-6px 0 12px' }}>
                선택 지역·기간 내 단지들을 {isRent ? '전세보증금' : '매매'} 평당가 기준으로 정렬했어요.
                값이 비슷한 단지끼리 가까이 있어서 한눈에 비교하기 좋아요. 단지명을 누르면 상세 내역이 열립니다.
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
                      <th style={{ ...styles.th, width: 90 }}>최근 계약일</th>
                      <th style={{ ...styles.th, width: 70 }}>거래건수</th>
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
                        <td style={styles.td}>{c.year}.{c.month}.{c.day}</td>
                        <td style={styles.td}>{c.count}</td>
                      </tr>
                    ))}
                    {complexCompare.length === 0 && (
                      <tr><td style={styles.td} colSpan={8}>비교할 단지가 없습니다.</td></tr>
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
              {labelFor(selectedApt.regionCode)} · 현재 조회된 기간 내 실거래 내역 {aptHistory.length}건
              {isRatio || isRone ? '' : ` (${isRent ? '전월세' : '매매'} 기준)`}
            </p>
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
                  {aptHistory.map((t, i) => (
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
                  {aptHistory.length === 0 && (
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
          .hero-wrap { height: 60vh !important; }
          .dash-sidebar-float {
            max-height: 75vh !important;
            width: min(300px, calc(100vw - 32px)) !important;
          }
          .drill-select-bar {
            top: 60px !important;
            padding: 6px !important;
            max-width: calc(100vw - 24px);
          }
          .drill-select-bar select { width: 108px !important; font-size: 11px !important; }
          .dash-main { padding: 16px !important; }
          .dash-title { font-size: 20px !important; }
        }
      `}</style>
    </div>
  );
}

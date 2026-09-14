'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { RefreshCw, TrendingUp, TrendingDown, AlertCircle, X, Building2 } from 'lucide-react';
import { REGION_GROUPS, regionLabel, SIDO_AGGREGATES, isSidoAggregate } from '../lib/regions';
import { SIDO_REGIONS, roneRegionLabel } from '../lib/rone-regions';

const RONE_ONLY_EXTRA = SIDO_REGIONS.filter((r) => ['90001', '90002', '90003'].includes(r.code));

const DEFAULT_SELECTED = ['11000'];
const LINE_COLORS = ['#C79A46', '#5B8AA6', '#B85C4A', '#6B8F5E', '#8B7EC8', '#C4763A'];

const PALETTE = {
  bg: '#EFEEE8',
  panel: '#FFFFFF',
  panelAlt: '#F5F4EF',
  border: '#DEDBCF',
  borderStrong: '#C6C2B2',
  textPrimary: '#211F1A',
  textSecondary: '#5C594E',
  textMuted: '#8B8775',
  up: '#B23A2E',
  down: '#2F5FA0',
  accent: '#B23A2E',
};
const ACCENT_TEXT = '#FDF6F3';

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

function monthLabel(ym) {
  return `${ym.slice(0, 4)}.${ym.slice(4, 6)}`;
}

function labelFor(code) {
  return roneRegionLabel(code, regionLabel(code));
}

export default function Page() {
  const [dealType, setDealType] = useState('trade');
  const [monthCount, setMonthCount] = useState(6);
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

  // 단지명 클릭 시 표시할 거래내역 모달
  const [selectedComplex, setSelectedComplex] = useState(null);

  const closeComplexModal = () => setSelectedComplex(null);

  useEffect(() => {
    if (!selectedComplex) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') closeComplexModal();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedComplex]);

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
      name, dealType, monthCount, selected: [...selected],
    }];
    persistFavorites(next);
    setFavName('');
  };

  const applyFavorite = (fav) => {
    setDealTypeSafe(fav.dealType);
    setMonthCount(fav.monthCount);
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

  const handleFetch = async () => {
    setErrorMsg('');
    if (selected.length === 0) {
      setErrorMsg('지역을 하나 이상 선택해주세요.');
      return;
    }
    setStatus('loading');
    try {
      if (dealType === 'rone') {
        const res = await fetch(`/api/rone?codes=${selected.join(',')}&months=${monthCount}`);
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
          fetch(`/api/trades?codes=${selected.join(',')}&months=${monthCount}`),
          fetch(`/api/rents?codes=${selected.join(',')}&months=${monthCount}`),
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
      const res = await fetch(`${endpoint}?codes=${selected.join(',')}&months=${monthCount}`);
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

  // 가격 추이 그래프의 Y축을 실제 데이터 범위에 맞춰 자동 조정합니다.
  // 기존처럼 0부터 크게 잡지 않고, 최저/최고값 주변에 약 15% 여백만 둬
  // 월별 가격 변동이 더 잘 보이도록 합니다.
  const priceChartDomain = useMemo(() => {
    const values = chartData
      .flatMap((row) => selected.map((code) => row[labelFor(code)]))
      .filter((v) => typeof v === 'number' && Number.isFinite(v));

    if (!values.length) return ['auto', 'auto'];

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;

    if (range === 0) {
      const padding = Math.max(Math.abs(min) * 0.05, 0.1);
      return [Math.max(0, min - padding), max + padding];
    }

    const padding = range * 0.15;
    return [Math.max(0, min - padding), max + padding];
  }, [chartData, selected]);

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

  const recentTx = useMemo(() => {
    const all = [];
    selected.forEach((code) => {
      months.forEach((ym) => {
        const rows = rawByRegionMonth[`${code}_${ym}`] || [];
        rows.forEach((r) => all.push({ ...r, regionCode: code }));
      });
    });
    all.sort((a, b) => {
      const da = `${a.year}${String(a.month).padStart(2, '0')}${String(a.day).padStart(2, '0')}`;
      const db = `${b.year}${String(b.month).padStart(2, '0')}${String(b.day).padStart(2, '0')}`;
      return db.localeCompare(da);
    });
    return all.slice(0, 30);
  }, [selected, months, rawByRegionMonth]);

  const complexTransactions = useMemo(() => {
    if (!selectedComplex) return [];

    const all = [];
    selected.forEach((code) => {
      months.forEach((ym) => {
        const rows = rawByRegionMonth[`${code}_${ym}`] || [];
        rows.forEach((r) => {
          if (
            code === selectedComplex.regionCode &&
            r.apt === selectedComplex.apt &&
            r.dong === selectedComplex.dong
          ) {
            all.push({ ...r, regionCode: code });
          }
        });
      });
    });

    all.sort((a, b) => {
      const da = `${a.year}${String(a.month).padStart(2, '0')}${String(a.day).padStart(2, '0')}`;
      const db = `${b.year}${String(b.month).padStart(2, '0')}${String(b.day).padStart(2, '0')}`;
      return db.localeCompare(da);
    });

    return all;
  }, [selectedComplex, selected, months, rawByRegionMonth]);

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

  const isRent = dealType === 'rent';
  const isRone = dealType === 'rone';
  const isRatio = dealType === 'ratio';

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

  const styles = {
    page: {
      background: PALETTE.bg, color: PALETTE.textPrimary,
      fontFamily: "'Pretendard', 'Noto Sans KR', system-ui, sans-serif",
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
      borderRadius: 6, padding: '8px 10px', color: PALETTE.textPrimary, fontSize: 13,
    },
    btn: {
      background: PALETTE.accent, color: ACCENT_TEXT, border: 'none', borderRadius: 6,
      padding: '10px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%',
    },
    toggleBtn: (active) => ({
      flex: 1, textAlign: 'center', padding: '8px 0', borderRadius: 6, fontSize: 13, cursor: 'pointer',
      border: `1px solid ${active ? PALETTE.accent : PALETTE.border}`,
      background: active ? 'rgba(178,58,46,0.10)' : 'transparent',
      color: active ? PALETTE.up : PALETTE.textSecondary,
    }),
    chip: {
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 14,
      border: `1px solid ${PALETTE.accent}`, background: 'rgba(178,58,46,0.10)',
      color: PALETTE.up, fontSize: 12,
    },
    card: { background: PALETTE.panel, border: `1px solid ${PALETTE.border}`, borderRadius: 10, padding: '16px 18px' },
    kpiLabel: { fontSize: 12, color: PALETTE.textMuted, marginBottom: 6 },
    kpiValue: { fontSize: 24, fontWeight: 600, fontFamily: "'Noto Serif KR', serif" },
    sectionTitle: { fontFamily: "'Noto Serif KR', serif", fontSize: 18, fontWeight: 600, margin: '0 0 12px' },
    th: { textAlign: 'left', fontSize: 11, color: PALETTE.textMuted, fontWeight: 500, padding: '6px 10px', borderBottom: `1px solid ${PALETTE.border}` },
    td: { fontSize: 13, padding: '8px 10px', borderBottom: `1px solid ${PALETTE.border}`, color: PALETTE.textPrimary },
  };

  return (
    <div style={styles.page} className="dash-shell">
      <aside style={styles.sidebar} className="dash-sidebar">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Building2 size={18} color={PALETTE.accent} />
            <span style={{ fontFamily: "'Noto Serif KR', serif", fontSize: 16, fontWeight: 600 }}>
              아파트 실거래가 대시보드
            </span>
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
          <div style={{ display: 'flex', gap: 6 }}>
            {[3, 6, 12].map((n) => (
              <div key={n} onClick={() => setMonthCount(n)} style={styles.toggleBtn(monthCount === n)}>
                최근 {n}개월
              </div>
            ))}
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
            <button onClick={saveFavorite} style={{ ...styles.btn, width: 68, padding: 0 }}>저장</button>
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
                  border: `1px solid ${PALETTE.border}`, borderRadius: 6, padding: '6px 8px',
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

        <button style={styles.btn} onClick={handleFetch} disabled={status === 'loading'}>
          <RefreshCw size={14} className={status === 'loading' ? 'spin' : ''} />
          {status === 'loading' ? '조회 중...' : '데이터 조회'}
        </button>

        {errorMsg && (
          <div style={{
            display: 'flex', gap: 8, fontSize: 12, color: PALETTE.down,
            background: 'rgba(196,119,106,0.1)', border: `1px solid ${PALETTE.down}`, borderRadius: 6, padding: 10,
          }}>
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{errorMsg}</span>
          </div>
        )}
      </aside>

      <main style={styles.main} className="dash-main">
        <div>
          <h1 className="dash-title" style={{ fontFamily: "'Noto Serif KR', serif", fontSize: 24, margin: '0 0 4px' }}>
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
              <div style={styles.card}>
                <div style={styles.kpiLabel}>선택 지역 평균 전세가율</div>
                <div style={styles.kpiValue}>{ratioKpis.avg != null ? `${ratioKpis.avg.toFixed(1)}%` : '-'}</div>
              </div>
              <div style={styles.card}>
                <div style={styles.kpiLabel}>전세가율 최고 지역</div>
                <div style={{ ...styles.kpiValue, fontSize: 16 }}>
                  {ratioKpis.highest ? `${ratioKpis.highest.name} ${ratioKpis.highest.ratio.toFixed(1)}%` : '-'}
                </div>
              </div>
              <div style={styles.card}>
                <div style={styles.kpiLabel}>전세가율 최저 지역</div>
                <div style={{ ...styles.kpiValue, fontSize: 16 }}>
                  {ratioKpis.lowest ? `${ratioKpis.lowest.name} ${ratioKpis.lowest.ratio.toFixed(1)}%` : '-'}
                </div>
              </div>
            </div>

            <div style={styles.card}>
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

            <div style={styles.card}>
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
                background: 'rgba(196,119,106,0.1)', border: `1px solid ${PALETTE.down}`, borderRadius: 6, padding: 10,
              }}>
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>이 통계를 아직 지원하지 않는 지역: {roneUnmapped.map(labelFor).join(', ')}</span>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              <div style={styles.card}>
                <div style={styles.kpiLabel}>선택 지역 평균매매가격 평균</div>
                <div style={styles.kpiValue}>
                  {roneKpis.avg != null ? `${Math.round(roneKpis.avg).toLocaleString()}${roneKpis.unit || '만원'}` : '-'}
                </div>
              </div>
              <div style={styles.card}>
                <div style={styles.kpiLabel}>기간 내 최고 상승</div>
                <div style={{ ...styles.kpiValue, fontSize: 16, color: PALETTE.up, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <TrendingUp size={15} />
                  {roneKpis.rising ? `${roneKpis.rising.name} ${fmtPct(roneKpis.rising.change)}` : '-'}
                </div>
              </div>
              <div style={styles.card}>
                <div style={styles.kpiLabel}>기간 내 최고 하락</div>
                <div style={{ ...styles.kpiValue, fontSize: 16, color: PALETTE.down, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <TrendingDown size={15} />
                  {roneKpis.falling ? `${roneKpis.falling.name} ${fmtPct(roneKpis.falling.change)}` : '-'}
                </div>
              </div>
            </div>

            <div style={styles.card}>
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

            <div style={styles.card}>
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
              <div style={styles.card}>
                <div style={styles.kpiLabel}>조회된 거래 건수</div>
                <div style={styles.kpiValue}>{kpis.totalCount.toLocaleString()}건</div>
              </div>
              <div style={styles.card}>
                <div style={styles.kpiLabel}>선택 지역 평균 {unitLabel}</div>
                <div style={styles.kpiValue}>{kpis.avgPyeongAll ? fmtWon(kpis.avgPyeongAll) : '-'}</div>
              </div>
              {isRent && (
                <div style={styles.card}>
                  <div style={styles.kpiLabel}>평균 월세 (월세 있는 거래)</div>
                  <div style={styles.kpiValue}>{kpis.avgMonthlyRent ? `${Math.round(kpis.avgMonthlyRent).toLocaleString()}만` : '-'}</div>
                </div>
              )}
              <div style={styles.card}>
                <div style={styles.kpiLabel}>기간 내 최고 상승</div>
                <div style={{ ...styles.kpiValue, fontSize: 16, color: PALETTE.up, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <TrendingUp size={15} />
                  {kpis.rising ? `${kpis.rising.name} ${fmtPct(kpis.rising.change)}` : '-'}
                </div>
              </div>
              <div style={styles.card}>
                <div style={styles.kpiLabel}>기간 내 최고 하락</div>
                <div style={{ ...styles.kpiValue, fontSize: 16, color: PALETTE.down, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <TrendingDown size={15} />
                  {kpis.falling ? `${kpis.falling.name} ${fmtPct(kpis.falling.change)}` : '-'}
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <h2 style={styles.sectionTitle}>
                {unitLabel} 추이 (만원/3.3㎡{isRent ? ', 전세 거래 기준' : ''})
              </h2>
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={PALETTE.border} vertical={false} />
                    <XAxis dataKey="ym" stroke={PALETTE.textMuted} fontSize={11} tickLine={false} />
                    <YAxis stroke={PALETTE.textMuted} fontSize={11} tickLine={false} width={48} domain={priceChartDomain} />
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

            <div style={styles.card}>
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

            <div style={styles.card}>
              <h2 style={styles.sectionTitle}>최근 거래 내역</h2>
              <div style={{ maxHeight: 320, overflowY: 'auto', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={styles.th}>지역</th>
                      <th style={styles.th}>단지명</th>
                      <th style={styles.th}>계약일</th>
                      <th style={styles.th}>전용면적</th>
                      <th style={styles.th}>층</th>
                      {isRent ? (
                        <>
                          <th style={styles.th}>구분</th>
                          <th style={styles.th}>보증금</th>
                          <th style={styles.th}>월세</th>
                        </>
                      ) : (
                        <th style={styles.th}>거래금액</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {recentTx.map((t, i) => (
                      <tr key={i}>
                        <td style={styles.td}>{regionLabel(t.regionCode)}</td>
                        <td style={styles.td}>
                          <button
                            type="button"
                            onClick={() => setSelectedComplex({
                              regionCode: t.regionCode,
                              apt: t.apt,
                              dong: t.dong,
                            })}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              padding: 0,
                              margin: 0,
                              color: PALETTE.accent,
                              fontWeight: 600,
                              cursor: 'pointer',
                              textAlign: 'left',
                              fontSize: 13,
                              textDecoration: 'underline',
                              textUnderlineOffset: 3,
                            }}
                            title="클릭하면 이 단지의 최근 거래내역을 볼 수 있습니다."
                          >
                            {t.apt} ({t.dong})
                          </button>
                        </td>
                        <td style={styles.td}>{t.year}.{t.month}.{t.day}</td>
                        <td style={styles.td}>{t.area?.toFixed(1)}㎡</td>
                        <td style={styles.td}>{t.floor}층</td>
                        {isRent ? (
                          <>
                            <td style={styles.td}>{t.isJeonse ? '전세' : '월세'}</td>
                            <td style={styles.td}>{fmtWon(t.deposit)}</td>
                            <td style={styles.td}>{t.isJeonse ? '-' : `${t.monthlyRent.toLocaleString()}만`}</td>
                          </>
                        ) : (
                          <td style={styles.td}>{fmtWon(t.amount)}</td>
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
          <div style={{ ...styles.card, textAlign: 'center', padding: '60px 20px', color: PALETTE.textMuted }}>
            데이터가 아직 없습니다. 왼쪽 패널에서 조건을 설정하고 조회를 눌러주세요.
          </div>
        )}
      </main>

      {selectedComplex && (
        <div
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeComplexModal();
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(33,31,26,0.48)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="complex-modal-title"
            style={{
              width: 'min(920px, 100%)',
              maxHeight: 'min(760px, calc(100vh - 40px))',
              overflow: 'hidden',
              background: PALETTE.panel,
              border: `1px solid ${PALETTE.borderStrong}`,
              borderRadius: 12,
              boxShadow: '0 18px 60px rgba(0,0,0,0.20)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '18px 20px 14px',
              borderBottom: `1px solid ${PALETTE.border}`,
              flexShrink: 0,
            }}>
              <div>
                <h2
                  id="complex-modal-title"
                  style={{
                    fontFamily: "'Noto Serif KR', serif",
                    fontSize: 20,
                    margin: 0,
                    fontWeight: 600,
                  }}
                >
                  {selectedComplex.apt}
                </h2>
                <p style={{ fontSize: 12, color: PALETTE.textMuted, margin: '5px 0 0' }}>
                  {regionLabel(selectedComplex.regionCode)} · {selectedComplex.dong}
                  {' · '}최근 {monthCount}개월 실거래
                </p>
              </div>
              <button
                type="button"
                onClick={closeComplexModal}
                aria-label="거래내역 닫기"
                style={{
                  width: 34,
                  height: 34,
                  border: `1px solid ${PALETTE.border}`,
                  borderRadius: 7,
                  background: PALETTE.panelAlt,
                  color: PALETTE.textSecondary,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <X size={17} />
              </button>
            </div>

            <div style={{ padding: '12px 20px 8px', flexShrink: 0 }}>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                background: PALETTE.panelAlt,
                border: `1px solid ${PALETTE.border}`,
                borderRadius: 7,
                padding: '7px 10px',
                fontSize: 12,
                color: PALETTE.textSecondary,
              }}>
                <strong style={{ color: PALETTE.textPrimary }}>
                  {complexTransactions.length.toLocaleString()}건
                </strong>
                의 거래가 조회되었습니다.
              </div>
            </div>

            <div style={{
              overflow: 'auto',
              padding: '0 20px 20px',
            }}>
              {complexTransactions.length === 0 ? (
                <div style={{
                  padding: '48px 20px',
                  textAlign: 'center',
                  color: PALETTE.textMuted,
                  fontSize: 13,
                }}>
                  조회된 기간에 해당 단지의 거래내역이 없습니다.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
                  <thead style={{ position: 'sticky', top: 0, background: PALETTE.panel, zIndex: 1 }}>
                    <tr>
                      <th style={styles.th}>계약일</th>
                      <th style={styles.th}>동</th>
                      <th style={styles.th}>전용면적</th>
                      <th style={styles.th}>층</th>
                      {isRent ? (
                        <>
                          <th style={styles.th}>구분</th>
                          <th style={styles.th}>보증금</th>
                          <th style={styles.th}>월세</th>
                          <th style={styles.th}>계약형태</th>
                        </>
                      ) : (
                        <>
                          <th style={styles.th}>거래금액</th>
                          <th style={styles.th}>평당가</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {complexTransactions.map((t, i) => (
                      <tr key={`${t.year}-${t.month}-${t.day}-${t.area}-${t.floor}-${i}`}>
                        <td style={styles.td}>{t.year}.{t.month}.{t.day}</td>
                        <td style={styles.td}>{t.dong || '-'}</td>
                        <td style={styles.td}>{t.area != null ? `${t.area.toFixed(1)}㎡` : '-'}</td>
                        <td style={styles.td}>{t.floor != null ? `${t.floor}층` : '-'}</td>
                        {isRent ? (
                          <>
                            <td style={styles.td}>{t.isJeonse ? '전세' : '월세'}</td>
                            <td style={styles.td}>{fmtWon(t.deposit)}</td>
                            <td style={styles.td}>{t.isJeonse ? '-' : `${t.monthlyRent.toLocaleString()}만`}</td>
                            <td style={styles.td}>{t.contractType || '-'}</td>
                          </>
                        ) : (
                          <>
                            <td style={styles.td}>{fmtWon(t.amount)}</td>
                            <td style={styles.td}>{t.pricePerPyeong != null ? fmtWon(t.pricePerPyeong) : '-'}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .dash-shell { display: grid; grid-template-columns: minmax(240px, 280px) 1fr; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        @media (max-width: 820px) {
          .dash-shell { grid-template-columns: 1fr; }
          .dash-sidebar { border-right: none !important; border-bottom: 1px solid ${PALETTE.border}; padding: 16px !important; }
          .dash-main { padding: 16px !important; }
          .dash-title { font-size: 20px !important; }
        }
      `}</style>
    </div>
  );
}

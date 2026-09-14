'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { RefreshCw, TrendingUp, TrendingDown, AlertCircle, Plus, X, Building2 } from 'lucide-react';

const SEOUL_GU = [
  { name: '종로구', code: '11110' }, { name: '중구', code: '11140' },
  { name: '용산구', code: '11170' }, { name: '성동구', code: '11200' },
  { name: '광진구', code: '11215' }, { name: '동대문구', code: '11230' },
  { name: '중랑구', code: '11260' }, { name: '성북구', code: '11290' },
  { name: '강북구', code: '11305' }, { name: '도봉구', code: '11320' },
  { name: '노원구', code: '11350' }, { name: '은평구', code: '11380' },
  { name: '서대문구', code: '11410' }, { name: '마포구', code: '11440' },
  { name: '양천구', code: '11470' }, { name: '강서구', code: '11500' },
  { name: '구로구', code: '11530' }, { name: '금천구', code: '11545' },
  { name: '영등포구', code: '11560' }, { name: '동작구', code: '11590' },
  { name: '관악구', code: '11620' }, { name: '서초구', code: '11650' },
  { name: '강남구', code: '11680' }, { name: '송파구', code: '11710' },
  { name: '강동구', code: '11740' },
];

const DEFAULT_SELECTED = ['11680', '11650', '11710', '11440'];
const LINE_COLORS = ['#C79A46', '#5B8AA6', '#B85C4A', '#6B8F5E', '#8B7EC8', '#C4763A'];

const PALETTE = {
  bg: '#12161D',
  panel: '#1A2029',
  panelAlt: '#20272F',
  border: '#2C3440',
  borderStrong: '#3A4451',
  textPrimary: '#EDEAE2',
  textSecondary: '#A6ADB8',
  textMuted: '#6E7683',
  up: '#C9AE73',
  down: '#C4776A',
  accent: '#C79A46',
};

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

export default function Page() {
  const [monthCount, setMonthCount] = useState(6);
  const [selected, setSelected] = useState(DEFAULT_SELECTED);
  const [customCode, setCustomCode] = useState('');
  const [customName, setCustomName] = useState('');
  const [customRegions, setCustomRegions] = useState([]);
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [rawByRegionMonth, setRawByRegionMonth] = useState({});
  const [months, setMonths] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);

  const allRegions = useMemo(() => [...SEOUL_GU, ...customRegions], [customRegions]);
  const regionName = useCallback(
    (code) => allRegions.find((r) => r.code === code)?.name || code,
    [allRegions],
  );

  const toggleRegion = (code) => {
    setSelected((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const addCustomRegion = () => {
    const code = customCode.trim();
    if (!/^\d{5}$/.test(code)) {
      setErrorMsg('지역코드는 숫자 5자리여야 합니다 (code.go.kr 법정동코드 앞 5자리).');
      return;
    }
    const name = customName.trim() || code;
    setCustomRegions((prev) => (prev.some((r) => r.code === code) ? prev : [...prev, { name, code }]));
    setSelected((prev) => (prev.includes(code) ? prev : [...prev, code]));
    setCustomCode('');
    setCustomName('');
    setErrorMsg('');
  };

  const handleFetch = async () => {
    setErrorMsg('');
    if (selected.length === 0) {
      setErrorMsg('지역을 하나 이상 선택해주세요.');
      return;
    }
    setStatus('loading');
    try {
      const res = await fetch(`/api/trades?codes=${selected.join(',')}&months=${monthCount}`);
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

  const monthlyByRegion = useMemo(() => {
    const out = {};
    selected.forEach((code) => {
      out[code] = months.map((ym) => {
        const rows = rawByRegionMonth[`${code}_${ym}`] || [];
        const valid = rows.filter((r) => r.pricePerPyeong);
        const avgPyeong = valid.length
          ? valid.reduce((s, r) => s + r.pricePerPyeong, 0) / valid.length
          : null;
        return { ym, count: rows.length, avgPyeong };
      });
    });
    return out;
  }, [selected, months, rawByRegionMonth]);

  const chartData = useMemo(() => {
    return months.map((ym) => {
      const row = { ym: monthLabel(ym) };
      selected.forEach((code) => {
        const m = monthlyByRegion[code]?.find((x) => x.ym === ym);
        row[regionName(code)] = m?.avgPyeong ? Math.round(m.avgPyeong / 10) / 100 : null;
      });
      return row;
    });
  }, [months, selected, monthlyByRegion, regionName]);

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
        code, name: regionName(code), latestAvgPyeong: last?.avgPyeong ?? null, change, totalCount,
      };
    }).sort((a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity));
  }, [selected, monthlyByRegion, regionName]);

  const kpis = useMemo(() => {
    const totalCount = ranking.reduce((s, r) => s + r.totalCount, 0);
    const withPyeong = ranking.filter((r) => r.latestAvgPyeong);
    const avgPyeongAll = withPyeong.length
      ? withPyeong.reduce((s, r) => s + r.latestAvgPyeong, 0) / withPyeong.length
      : null;
    const rising = ranking.filter((r) => r.change != null).sort((a, b) => b.change - a.change)[0];
    const falling = ranking.filter((r) => r.change != null).sort((a, b) => a.change - b.change)[0];
    return { totalCount, avgPyeongAll, rising, falling };
  }, [ranking]);

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

  const styles = {
    page: {
      background: PALETTE.bg, color: PALETTE.textPrimary,
      fontFamily: "'Pretendard', 'Noto Sans KR', system-ui, sans-serif",
      minHeight: '100vh', display: 'grid', gridTemplateColumns: 'minmax(240px, 280px) 1fr',
    },
    sidebar: {
      background: PALETTE.panel, borderRight: `1px solid ${PALETTE.border}`,
      padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 20,
    },
    main: { padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 24 },
    label: { fontSize: 12, color: PALETTE.textSecondary, marginBottom: 6, display: 'block' },
    input: {
      width: '100%', background: PALETTE.panelAlt, border: `1px solid ${PALETTE.border}`,
      borderRadius: 6, padding: '8px 10px', color: PALETTE.textPrimary, fontSize: 13,
    },
    btn: {
      background: PALETTE.accent, color: '#1A1408', border: 'none', borderRadius: 6,
      padding: '10px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%',
    },
    chip: (active) => ({
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 14,
      border: `1px solid ${active ? PALETTE.accent : PALETTE.border}`,
      background: active ? 'rgba(199,154,70,0.15)' : 'transparent',
      color: active ? PALETTE.up : PALETTE.textSecondary, fontSize: 12, cursor: 'pointer',
    }),
    card: { background: PALETTE.panel, border: `1px solid ${PALETTE.border}`, borderRadius: 10, padding: '16px 18px' },
    kpiLabel: { fontSize: 12, color: PALETTE.textMuted, marginBottom: 6 },
    kpiValue: { fontSize: 24, fontWeight: 600, fontFamily: "'Noto Serif KR', serif" },
    sectionTitle: { fontFamily: "'Noto Serif KR', serif", fontSize: 18, fontWeight: 600, margin: '0 0 12px' },
    th: { textAlign: 'left', fontSize: 11, color: PALETTE.textMuted, fontWeight: 500, padding: '6px 10px', borderBottom: `1px solid ${PALETTE.border}` },
    td: { fontSize: 13, padding: '8px 10px', borderBottom: `1px solid ${PALETTE.border}`, color: PALETTE.textPrimary },
  };

  return (
    <div style={styles.page}>
      <aside style={styles.sidebar}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Building2 size={18} color={PALETTE.accent} />
            <span style={{ fontFamily: "'Noto Serif KR', serif", fontSize: 16, fontWeight: 600 }}>
              아파트 실거래가 대시보드
            </span>
          </div>
          <p style={{ fontSize: 11.5, color: PALETTE.textMuted, lineHeight: 1.5, margin: 0 }}>
            국토교통부 아파트 매매 실거래 공개자료 기반. 접속할 때마다 서버가 최신 데이터를 가져옵니다.
          </p>
        </div>

        <div>
          <label style={styles.label}>조회 기간</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {[3, 6, 12].map((n) => (
              <button
                key={n}
                onClick={() => setMonthCount(n)}
                style={{ ...styles.chip(monthCount === n), flex: 1, justifyContent: 'center', padding: '7px 0' }}
              >
                최근 {n}개월
              </button>
            ))}
          </div>
        </div>

        <div>
          <label style={styles.label}>지역 선택 (서울 자치구)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
            {allRegions.map((r) => (
              <span key={r.code} style={styles.chip(selected.includes(r.code))} onClick={() => toggleRegion(r.code)}>
                {r.name}
              </span>
            ))}
          </div>
        </div>

        <div>
          <label style={styles.label}>다른 지역 코드 직접 추가</label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input style={{ ...styles.input, width: 70 }} placeholder="코드5자리" value={customCode}
              onChange={(e) => setCustomCode(e.target.value)} maxLength={5} />
            <input style={styles.input} placeholder="지역명(선택)" value={customName}
              onChange={(e) => setCustomName(e.target.value)} />
            <button onClick={addCustomRegion} style={{ ...styles.btn, width: 36, padding: 0 }} aria-label="지역 추가">
              <Plus size={16} />
            </button>
          </div>
          {customRegions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {customRegions.map((r) => (
                <span key={r.code} style={{ ...styles.chip(selected.includes(r.code)), display: 'inline-flex' }}>
                  <span onClick={() => toggleRegion(r.code)}>{r.name}</span>
                  <X size={11} style={{ marginLeft: 2 }} onClick={() => {
                    setCustomRegions((prev) => prev.filter((x) => x.code !== r.code));
                    setSelected((prev) => prev.filter((c) => c !== r.code));
                  }} />
                </span>
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

      <main style={styles.main}>
        <div>
          <h1 style={{ fontFamily: "'Noto Serif KR', serif", fontSize: 24, margin: '0 0 4px' }}>
            선택 지역 아파트 매매 시황
          </h1>
          <p style={{ fontSize: 12.5, color: PALETTE.textMuted, margin: 0 }}>
            {fetchedAt
              ? `${fetchedAt.toLocaleString('ko-KR')} 기준 · 실거래 신고 특성상 최근 1~2개월 데이터는 계속 채워지는 중일 수 있습니다.`
              : '왼쪽에서 지역을 설정한 뒤 데이터 조회를 눌러주세요.'}
          </p>
        </div>

        {status === 'done' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              <div style={styles.card}>
                <div style={styles.kpiLabel}>조회된 거래 건수</div>
                <div style={styles.kpiValue}>{kpis.totalCount.toLocaleString()}건</div>
              </div>
              <div style={styles.card}>
                <div style={styles.kpiLabel}>선택 지역 평균 평당가</div>
                <div style={styles.kpiValue}>{kpis.avgPyeongAll ? fmtWon(kpis.avgPyeongAll) : '-'}</div>
              </div>
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
              <h2 style={styles.sectionTitle}>평당가 추이 (만원/3.3㎡)</h2>
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
                      <Line key={code} type="monotone" dataKey={regionName(code)}
                        stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={styles.card}>
              <h2 style={styles.sectionTitle}>지역별 순위</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={styles.th}>지역</th>
                    <th style={styles.th}>최근월 평당가</th>
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

            <div style={styles.card}>
              <h2 style={styles.sectionTitle}>최근 거래 내역</h2>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={styles.th}>지역</th>
                      <th style={styles.th}>단지명</th>
                      <th style={styles.th}>계약일</th>
                      <th style={styles.th}>전용면적</th>
                      <th style={styles.th}>층</th>
                      <th style={styles.th}>거래금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTx.map((t, i) => (
                      <tr key={i}>
                        <td style={styles.td}>{regionName(t.regionCode)}</td>
                        <td style={styles.td}>{t.apt} ({t.dong})</td>
                        <td style={styles.td}>{t.year}.{t.month}.{t.day}</td>
                        <td style={styles.td}>{t.area?.toFixed(1)}㎡</td>
                        <td style={styles.td}>{t.floor}층</td>
                        <td style={styles.td}>{fmtWon(t.amount)}</td>
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

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}

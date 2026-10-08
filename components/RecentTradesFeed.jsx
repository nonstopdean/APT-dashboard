import React, { useEffect, useMemo, useState } from 'react';
import { PALETTE, fmtWon, fmtArea, fmtPct } from '../lib/ui-helpers';
import { regionLabel } from '../lib/regions';
import { buildTradeFeed } from '../lib/trade-feed';

// 지도 패널의 "최근 거래" 탭(호갱노노·아실의 거래 현황). 선택한 지역의 최근 30일 아파트 매매를 최신순으로 보여주고,
// 같은 단지·같은 면적의 직전 3년 최고가를 넘은 거래에 "신고가"를 붙인다. 조회 기간(6개월)과 별개로 3년치를 받는다
// (지난 달 자료는 서버가 30일 저장 — lib/molit.js).
const ymOf = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
const isSidoAggregate = (code) => /000$/.test(String(code || ''));

export default function RecentTradesFeed({ codes, isTrade, onPick }) {
  const [rowsByCode, setRowsByCode] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [onlyHighs, setOnlyHighs] = useState(false);
  const [limit, setLimit] = useState(60);

  const usable = (codes || []).filter((c) => c && !isSidoAggregate(c)).slice(0, 3);
  const skipped = (codes || []).length - usable.length;
  const codesKey = usable.join(',');
  const now = new Date();
  const endYm = ymOf(now);
  const start = new Date(now.getFullYear(), now.getMonth() - 35, 1);
  const startYm = ymOf(start);
  const todayKey = `${endYm}${String(now.getDate()).padStart(2, '0')}`;

  useEffect(() => {
    if (!isTrade) return undefined;
    const missing = usable.filter((c) => !rowsByCode[c]);
    if (!missing.length) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all(missing.map((code) => fetch(`/api/trades?codes=${code}&start=${startYm}&end=${endYm}`)
      .then((res) => res.json())
      .then((json) => {
        const rows = [];
        (json?.months || []).forEach((ym) => {
          (json?.data?.[`${code}_${ym}`] || []).forEach((r) => rows.push({ ...r, regionCode: code }));
        });
        return [code, rows];
      })
      .catch(() => [code, null])))
      .then((results) => {
        if (cancelled) return;
        setRowsByCode((prev) => {
          const next = { ...prev };
          results.forEach(([code, rows]) => { if (rows) next[code] = rows; });
          return next;
        });
        if (results.some(([, rows]) => !rows)) setError('일부 지역을 불러오지 못했어요');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codesKey, isTrade]);

  const feed = useMemo(() => {
    const rows = usable.flatMap((c) => rowsByCode[c] || []);
    return buildTradeFeed(rows, { todayKey, recentDays: 30 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsByCode, codesKey, todayKey]);

  if (!isTrade) {
    return <div style={{ padding: 14, fontSize: 12, color: PALETTE.textMuted }}>최근 거래·신고가는 "매매"에서 볼 수 있어요.</div>;
  }
  if (!usable.length) {
    return <div style={{ padding: 14, fontSize: 12, color: PALETTE.textMuted }}>구·시를 하나 이상 골라주세요. 시·도 전체는 3년치를 받기엔 호출이 너무 많아요.</div>;
  }

  const shown = (onlyHighs ? feed.items.filter((r) => r.isHigh) : feed.items).slice(0, limit);
  const s = feed.summary;
  const pill = (on) => ({
    border: `1px solid ${on ? PALETTE.accent : PALETTE.border}`, background: on ? PALETTE.accent : PALETTE.panel,
    color: on ? '#fff' : PALETTE.textPrimary, borderRadius: 999, padding: '3px 9px', fontSize: 11, cursor: 'pointer',
  });

  return (
    <div>
      <div style={{ padding: '8px 14px', fontSize: 11, color: PALETTE.textMuted, borderBottom: `1px solid ${PALETTE.border}`, lineHeight: 1.6 }}>
        {loading && !feed.items.length ? '최근 3년 실거래를 불러오는 중... (처음엔 10초 안팎)' : (
          <>
            최근 30일 <b style={{ color: PALETTE.textPrimary }}>{s.recent}건</b>
            {s.changePct != null && (
              <span style={{ color: s.changePct > 0 ? PALETTE.up : s.changePct < 0 ? PALETTE.down : PALETTE.textMuted }}>
                {' '}(직전 30일 {s.prev}건 대비 {fmtPct(s.changePct)})
              </span>
            )}
            {' · '}신고가 <b style={{ color: PALETTE.up }}>{s.highs}건</b>
            <div>아파트 매매 · 신고가 = 같은 단지·면적의 직전 3년 최고가 초과. 실거래는 계약 후 30일 안에 접수되니 최근 1~2주는 더 늘어날 수 있어요.</div>
          </>
        )}
        {error && <div style={{ color: '#B23A2E' }}>{error}</div>}
        {skipped > 0 && <div>시·도 전체 등 {skipped}개 지역은 빠졌어요(구·시만, 최대 3곳).</div>}
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button style={pill(!onlyHighs)} onClick={() => setOnlyHighs(false)}>전체</button>
          <button style={pill(onlyHighs)} onClick={() => setOnlyHighs(true)}>신고가만</button>
        </div>
      </div>
      {shown.map((r, i) => (
        <button
          key={`${r.regionCode}|${r.dong}|${r.apt}|${r.dateKey}|${r.amount}|${r.floor}|${i}`}
          onClick={() => onPick && onPick(r)}
          style={{ width: '100%', textAlign: 'left', border: 'none', borderBottom: `1px solid ${PALETTE.border}`, background: 'transparent', padding: '10px 14px', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.isHigh && <span style={{ background: PALETTE.up, color: '#fff', borderRadius: 4, padding: '0 4px', fontSize: 10, marginRight: 4 }}>신고가</span>}
                {r.apt}
              </div>
              <div style={{ fontSize: 10.5, color: PALETTE.textMuted, marginTop: 3 }}>
                {`${r.dateKey.slice(4, 6)}.${r.dateKey.slice(6, 8)}`} · {regionLabel(r.regionCode)} {r.dong}{r.floor ? ` · ${r.floor}층` : ''}
              </div>
            </div>
            <div style={{ flexShrink: 0, textAlign: 'right' }}>
              <div style={{ fontSize: 12.5, fontWeight: 800 }}>{fmtWon(r.amount)}</div>
              <div style={{ fontSize: 10, color: r.isHigh ? PALETTE.up : PALETTE.textMuted, marginTop: 3 }}>
                {fmtArea(r.area)}{r.isHigh && r.highPct != null ? ` · +${r.highPct.toFixed(1)}%` : ''}
              </div>
            </div>
          </div>
        </button>
      ))}
      {!loading && shown.length === 0 && (
        <div style={{ padding: 14, fontSize: 12, color: PALETTE.textMuted }}>{onlyHighs ? '최근 30일 신고가 거래가 없어요.' : '최근 30일 신고된 거래가 없어요.'}</div>
      )}
      {(onlyHighs ? feed.items.filter((r) => r.isHigh).length : feed.items.length) > limit && (
        <button onClick={() => setLimit((v) => v + 60)} style={{ width: '100%', border: 'none', background: 'transparent', padding: 12, fontSize: 12, color: PALETTE.accent, cursor: 'pointer' }}>
          더 보기
        </button>
      )}
    </div>
  );
}

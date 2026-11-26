'use client';

import { useEffect, useState } from 'react';
import { localComplexMatches } from '../lib/complex-search';
import { searchRegions, searchDongs } from '../lib/region-search';

// v238: 지도 탭 왼쪽 검색 패널 — 단지 이름·지역(시·도/시·군·구/동) 하나의 검색창.
// 결과를 누르면 지도가 그곳으로 가고, 단지면 상세가 열리고, 지역이면 아래에 그 지역 요약(summary)이 나온다.
// 단지는 불러온 지역(바로) + 전국(카카오 검색 /api/complex-search, 입력이 멈추고 0.3초 뒤).
const remoteCache = new Map();
const fmtPrice = (v) => (Number.isFinite(v) ? (v >= 10000 ? `${(v / 10000).toFixed(1).replace(/\.0$/, '')}억` : `${Math.round(v).toLocaleString()}만`) : '');

export default function MapSearchPanel({
  complexes = [], regionGroups, sidoAggregates, regionLabel, onPickComplex, onPickRegion, onPickDong,
  summary, onCloseSummary, onOpenDashboard, palette, recent = null, onOpenTrade, recentOpen = false, onToggleRecent,
}) {
  const P = palette;
  const [query, setQuery] = useState('');
  const [recentSort, setRecentSort] = useState('date'); // v267: 'date' | 'price'
  const [recentLimit, setRecentLimit] = useState(15);
  const [remote, setRemote] = useState({ q: '', rows: [], dongs: [], loading: false, error: '' });
  const q = query.trim();
  const qOk = q.replace(/\s+/g, '').length >= 2;

  useEffect(() => {
    if (!qOk) return undefined;
    if (remoteCache.has(q)) { setRemote({ q, ...remoteCache.get(q), loading: false, error: '' }); return undefined; }
    let cancelled = false;
    setRemote((r) => ({ ...r, loading: true, error: '' }));
    const t = setTimeout(() => {
      fetch(`/api/complex-search?q=${encodeURIComponent(q)}`)
        .then((res) => res.json())
        .then((json) => {
          if (cancelled) return;
          const rows = Array.isArray(json?.results) ? json.results : [];
          // v240: 서버가 함께 돌려주는 전국 동(카카오 주소 검색) — 지도에 안 불러온 지역의 동도 찾게
          const dongs = Array.isArray(json?.dongs) ? json.dongs : [];
          if (!json?.error) remoteCache.set(q, { rows, dongs });
          setRemote({ q, rows, dongs, loading: false, error: json?.error ? '단지 검색에 실패했어요.' : '' });
        })
        .catch(() => { if (!cancelled) setRemote({ q, rows: [], dongs: [], loading: false, error: '단지 검색에 실패했어요.' }); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, qOk]);

  const regions = qOk ? searchRegions(regionGroups, sidoAggregates, q, 8) : [];
  const localDongs = qOk ? searchDongs(complexes, q, 5) : [];
  const localDongIds = new Set(localDongs.map((d) => `${d.regionCode}|${d.dong}`));
  // 이름이 검색어와 딱 맞는 동·읍·면("봉담" → 봉담읍)을 그 아래 리("봉담읍 와우리")보다 먼저
  const qSq = q.replace(/\s+/g, '');
  const exactDong = (d) => [qSq, `${qSq}동`, `${qSq}읍`, `${qSq}면`].includes(String(d.dong || '').replace(/\s+/g, ''));
  const dongs = [...localDongs, ...(remote.q === q ? remote.dongs || [] : []).filter((d) => !localDongIds.has(`${d.regionCode}|${d.dong}`))]
    .sort((a, b) => Number(exactDong(b)) - Number(exactDong(a))).slice(0, 8);
  const localRows = qOk ? localComplexMatches(complexes, q, 6) : [];
  const localIds = new Set(localRows.map((c) => `${c.regionCode}|${c.dong}`));
  const squash = (s) => String(s || '').replace(/\s+/g, '');
  const remoteRows = (remote.q === q ? remote.rows : []).filter((r) => !localRows.some((c) => localIds.has(`${r.regionCode}|${r.dong}`)
    && (squash(c.apt).includes(squash(r.name)) || squash(r.name).includes(squash(c.apt)))));
  const loading = qOk && (remote.loading || remote.q !== q);
  const nothing = qOk && !loading && !regions.length && !dongs.length && !localRows.length && !remoteRows.length;

  const section = { padding: '10px 2px 4px', fontSize: 10.5, color: P.textMuted, fontWeight: 700 };
  const row = {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px', cursor: 'pointer',
    border: `1px solid ${P.border}`, borderRadius: 8, background: '#fff', marginTop: 4, fontSize: 12.5, color: P.textPrimary,
  };
  const pick = (fn) => (...args) => { setQuery(''); fn?.(...args); };

  return (
    <div data-map-search="1">
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: P.textSecondary, marginBottom: 6 }}>단지·지역 검색</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: `1.5px solid ${q ? P.accent : P.borderStrong}`, borderRadius: 10, padding: '0 10px', background: '#fff' }}>
        <span style={{ fontSize: 13 }}>🔍</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
            if (e.key === 'Enter') {
              // 엔터: 지역이 정확히 맞으면 지역, 아니면 첫 단지
              if (regions[0]) pick(onPickRegion)(regions[0]);
              else if (localRows[0]) pick(onPickComplex)(localRows[0]);
              else if (remoteRows[0]) pick(onPickComplex)(remoteRows[0]);
            }
          }}
          placeholder="예: 동탄역포레너스, 강서구, 역삼동"
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', padding: '10px 0', fontSize: 13, background: 'transparent' }}
        />
        {query && <span style={{ cursor: 'pointer', color: P.textMuted, fontSize: 14 }} onClick={() => setQuery('')}>✕</span>}
      </div>

      {!qOk && !summary && (
        <p style={{ fontSize: 11, color: P.textMuted, lineHeight: 1.5, margin: '8px 2px 0' }}>
          단지 이름이나 지역(시·구·동)을 두 글자 이상 적으면 바로 찾아요. 누르면 지도가 그곳으로 가요.
          지도를 움직이면 화면 안 단지가 자동으로 보여요.
        </p>
      )}

      {qOk && (
        <div style={{ maxHeight: 'calc(100vh - 260px)', overflowY: 'auto', marginTop: 4 }}>
          {regions.length > 0 && <div style={section}>지역</div>}
          {regions.map((r) => (
            <button key={`g${r.code}`} type="button" data-search-region={r.code} style={row} onClick={() => pick(onPickRegion)(r)}>
              <span style={{ fontSize: 13 }}>📍</span>
              <b style={{ flex: 1 }}>{r.label}</b>
              <span style={{ fontSize: 10.5, color: P.textMuted }}>{r.kind === 'sido' ? '시·도' : '시·군·구'}</span>
            </button>
          ))}
          {dongs.length > 0 && <div style={section}>동</div>}
          {dongs.map((d) => (
            <button key={`d${d.regionCode}|${d.dong}`} type="button" data-search-dong={d.lat != null ? 'remote' : 'local'} style={row} onClick={() => pick(onPickDong)(d)}>
              <span style={{ fontSize: 13 }}>🏘️</span>
              <b style={{ flex: 1 }}>{d.dong}</b>
              <span style={{ fontSize: 10.5, color: P.textMuted }}>{regionLabel(d.regionCode)}</span>
            </button>
          ))}
          {localRows.length > 0 && <div style={section}>단지 (지도에 불러온 곳)</div>}
          {localRows.map((c) => (
            <button key={`l${c.key}`} type="button" style={row} onClick={() => pick(onPickComplex)(c)}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.leader ? '👑 ' : ''}{c.apt}</b>
                <span style={{ fontSize: 11, color: P.textMuted }}>{regionLabel(c.regionCode)} {c.dong}</span>
              </span>
              {c.latestPrice != null && <span style={{ color: P.accent, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtPrice(c.latestPrice)}</span>}
            </button>
          ))}
          <div style={section}>단지 (전국){loading ? ' · 찾는 중…' : ''}</div>
          {!loading && remote.error && <div style={{ fontSize: 11.5, color: '#B23A2E', padding: '4px 2px' }}>{remote.error}</div>}
          {!loading && !remote.error && remoteRows.length === 0 && (
            <div style={{ fontSize: 11.5, color: P.textMuted, padding: '4px 2px' }}>{localRows.length ? '다른 곳에서 더 찾은 단지가 없어요.' : '이름이 맞는 아파트 단지가 없어요.'}</div>
          )}
          {remoteRows.map((r) => (
            <button key={`r${r.regionCode}|${r.dong}|${r.jibun}|${r.name}`} type="button" data-search-remote="1" style={row} onClick={() => pick(onPickComplex)(r)}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</b>
                <span style={{ fontSize: 11, color: P.textMuted }}>{r.address}</span>
              </span>
            </button>
          ))}
          {nothing && <div style={{ fontSize: 11.5, color: P.textMuted, padding: '6px 2px' }}>“{q}”에 맞는 지역·단지가 없어요. 띄어쓰기나 다른 이름으로 찾아보세요.</div>}
        </div>
      )}

      {!qOk && summary && (
        <div data-region-summary="1" style={{ marginTop: 10, border: `1px solid ${P.border}`, borderRadius: 12, padding: 12, background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <b style={{ fontSize: 14, flex: 1 }}>📍 {summary.label}</b>
            <span style={{ cursor: 'pointer', color: P.textMuted }} onClick={onCloseSummary} title="닫기">✕</span>
          </div>
          {/* v239: 시장 신호(지도 색칠과 같은 기준)와 한국부동산원 평균 매매가격 */}
          {summary.signal && (
            <div data-summary-signal="1" title={summary.signal.note} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '8px 10px', borderRadius: 8, background: P.panelAlt }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: summary.signal.color, flexShrink: 0 }} />
              <span style={{ minWidth: 0 }}>
                <b style={{ fontSize: 13 }}>시장 신호 · {summary.signal.label}</b>
                <span style={{ display: 'block', fontSize: 10.5, color: P.textMuted, marginTop: 1 }}>{summary.signal.desc} — {summary.signal.note}</span>
              </span>
            </div>
          )}
          {summary.rone && (
            <div data-summary-rone="1" style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, border: `1px solid ${P.border}` }}>
              <div style={{ fontSize: 10.5, color: P.textMuted }}>
                한국부동산원 아파트 평균 매매가{summary.rone.ofGu ? '(구 전체)' : ''}{summary.rone.ym ? ` · ${summary.rone.ym}` : ''}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
                <b style={{ fontSize: 15 }}>{summary.rone.value >= 10000 ? `${(summary.rone.value / 10000).toFixed(2)}억` : `${Math.round(summary.rone.value).toLocaleString()}만`}</b>
                {Number.isFinite(summary.rone.change) && (
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: summary.rone.change > 0 ? P.up : summary.rone.change < 0 ? P.down : P.textMuted }}>
                    전월 대비 {summary.rone.change > 0 ? '▲' : summary.rone.change < 0 ? '▼' : ''}{Math.abs(summary.rone.change).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          )}
          {summary.loading ? (
            <p style={{ fontSize: 11.5, color: P.textMuted, margin: '8px 0 0' }}>이 지역 거래를 불러오는 중이에요…</p>
          ) : summary.count ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
              {[
                ['단지', `${summary.complexes.toLocaleString()}곳`],
                [`거래(${summary.periodLabel})`, `${summary.count.toLocaleString()}건`],
                ['평균 평당가', summary.avgPyeong != null ? `${Math.round(summary.avgPyeong).toLocaleString()}만` : '-'],
                ['가격 흐름', summary.changeText || '-'],
              ].map(([k, v]) => (
                <div key={k} style={{ background: P.panelAlt, borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 10.5, color: P.textMuted }}>{k}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 800, marginTop: 2 }}>{v}</div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 11.5, color: P.textMuted, margin: '8px 0 0' }}>지도가 이 지역으로 가면 거래를 자동으로 불러와요.</p>
          )}
          {summary.note && <p style={{ fontSize: 10.5, color: P.textMuted, margin: '8px 0 0', lineHeight: 1.5 }}>{summary.note}</p>}
          {onOpenDashboard && (
            <button type="button" onClick={onOpenDashboard} style={{ marginTop: 10, width: '100%', border: `1px solid ${P.accent}`, color: P.accent, background: '#fff', borderRadius: 8, padding: '8px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              대시보드에서 자세히 보기
            </button>
          )}
        </div>
      )}

      {/* v269: 최근 실거래 목록은 누를 때만 계산·표시(지도 속도) */}
      {!qOk && onToggleRecent && (
        <button type="button" data-view-recent-toggle="1" onClick={onToggleRecent}
          style={{ marginTop: 14, width: '100%', border: `1px solid ${recentOpen ? P.accent : P.border}`, borderRadius: 10, padding: '9px 0', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', background: recentOpen ? P.accentSoft : '#fff', color: P.accentDark }}>
          {recentOpen ? '최근 실거래 접기 ▴' : '📍 지도 화면 최근 실거래 보기 ▾'}
        </button>
      )}
      {/* v267: 지금 지도 화면 안 단지들의 최근 실거래(디스코·부동산플래닛처럼 왼쪽에 지역 이름 + 목록) */}
      {!qOk && recent && recent.total > 0 && (() => {
        const rows = recentSort === 'price' ? [...recent.rows].sort((a, b) => b.price - a.price) : recent.rows;
        const pill = (on) => ({
          border: 'none', borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
          background: on ? P.accent : P.accentSoft, color: on ? '#fff' : P.accentDark,
        });
        const d8 = (s) => `${s.slice(2, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`;
        return (
          <div data-view-recent="1" style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <b style={{ fontSize: 15, color: P.textPrimary, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📍 {recent.title}</b>
            </div>
            <div style={{ fontSize: 11, color: P.textMuted, margin: '2px 0 8px' }}>
              지도 화면 안 단지 {recent.complexes.toLocaleString()}곳 · 최근 {recent.isRent ? '전월세' : '실거래'} {recent.total.toLocaleString()}건
            </div>
            {/* v267: 최근 3개월 요약 칸 */}
            {recent.stats && recent.stats.n3 > 0 && (
              <div data-view-recent-stats="1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
                {[
                  ['3개월 거래', `${recent.stats.n3.toLocaleString()}건`, null],
                  [recent.isRent ? '평당 보증금' : '평균 평당가', recent.stats.avg3 != null ? `${Math.round(recent.stats.avg3).toLocaleString()}만` : '-', null],
                  ['직전 3개월 대비', recent.stats.change != null ? `${recent.stats.change > 0 ? '▲' : recent.stats.change < 0 ? '▼' : ''}${Math.abs(recent.stats.change).toFixed(1)}%` : '-',
                    recent.stats.change > 0 ? P.up : recent.stats.change < 0 ? P.down : null],
                ].map(([k, v, c]) => (
                  <div key={k} style={{ background: P.panelAlt, borderRadius: 8, padding: '7px 8px', minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: P.textMuted, whiteSpace: 'nowrap' }}>{k}</div>
                    <div style={{ fontSize: 13, fontWeight: 800, marginTop: 2, color: c || P.textPrimary, whiteSpace: 'nowrap' }}>{v}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <button type="button" style={pill(recentSort === 'date')} onClick={() => { setRecentSort('date'); setRecentLimit(15); }}>최신순</button>
              <button type="button" style={pill(recentSort === 'price')} onClick={() => { setRecentSort('price'); setRecentLimit(15); }}>가격순</button>
            </div>
            <div style={{ border: `1px solid ${P.border}`, borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
              {rows.slice(0, recentLimit).map((r, i) => (
                <button key={`${r.key}|${r.d8}|${r.floor}|${r.price}|${i}`} type="button" data-view-recent-row="1" onClick={() => onOpenTrade?.(r)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderTop: i ? `1px solid ${P.border}` : 'none', background: 'transparent', cursor: 'pointer' }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                      <b style={{ fontSize: 12.5, color: P.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.apt}</b>
                      {r.d8 >= recent.newCut && <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, color: '#fff', background: P.accent, borderRadius: 4, padding: '1px 4px' }}>NEW</span>}
                      {r.high && <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, color: '#fff', background: P.up, borderRadius: 4, padding: '1px 4px' }}>🔺신고가</span>}
                    </span>
                    <span style={{ display: 'block', fontSize: 10.5, color: P.textMuted, marginTop: 2 }}>
                      {r.dong} · {Math.round(r.area)}㎡ · {r.floor}층 · {d8(r.d8)}
                    </span>
                  </span>
                  <b style={{ fontSize: 13, color: P.accentDark, whiteSpace: 'nowrap' }}>
                    {fmtPrice(r.price)}{r.rent ? <span style={{ fontSize: 11, fontWeight: 700 }}>/{r.rent.toLocaleString()}</span> : null}
                  </b>
                </button>
              ))}
            </div>
            {rows.length > recentLimit && (
              <button type="button" onClick={() => setRecentLimit((n) => n + 20)}
                style={{ marginTop: 6, width: '100%', border: 'none', borderRadius: 10, padding: '8px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: P.accentSoft, color: P.accentDark }}>
                더 보기 ({Math.min(rows.length, recent.rows.length) - recentLimit}건 남음)
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
}

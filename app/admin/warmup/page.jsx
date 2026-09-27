'use client';

import { useState } from 'react';
import { REGION_GROUPS } from '../../../lib/regions';

export default function WarmupPage() {
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState({}); // { [sidoName]: { total, found } }

  const appendLog = (line) => setLog((prev) => [...prev, line]);

  const runSido = async (sido) => {
    if (running) return;
    setRunning(true);
    const items = sido.items;
    setProgress({ done: 0, total: items.length });
    let sidoTotal = 0;
    let sidoFound = 0;
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i];
      appendLog(`⏳ ${it.name} 예열 중...`);
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch(`/api/geocode-warmup?code=${it.code}`);
        // eslint-disable-next-line no-await-in-loop
        const json = await res.json();
        if (json.error) {
          appendLog(`❌ ${it.name}: ${json.error}`);
        } else {
          appendLog(`✅ ${it.name}: 단지 ${json.totalComplexes}개 중 ${json.found}개 좌표 저장 완료`);
          sidoTotal += json.totalComplexes || 0;
          sidoFound += json.found || 0;
        }
      } catch (e) {
        appendLog(`❌ ${it.name}: 요청 실패 (${e.message})`);
      }
      setProgress({ done: i + 1, total: items.length });
    }
    setSummary((prev) => ({ ...prev, [sido.sido]: { total: sidoTotal, found: sidoFound } }));
    appendLog(`🎉 ${sido.sido} 완료! (전체 ${sidoTotal}개 중 ${sidoFound}개 좌표 확보, 미확보 ${sidoTotal - sidoFound}개)`);
    setRunning(false);
  };

  const runAll = async () => {
    if (running) return;
    setLog([]);
    setSummary({});
    // eslint-disable-next-line no-restricted-syntax
    for (const g of REGION_GROUPS) {
      // eslint-disable-next-line no-await-in-loop
      await runSido(g);
    }
  };

  const totals = Object.values(summary).reduce((s, v) => ({ total: s.total + v.total, found: s.found + v.found }), { total: 0, found: 0 });

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24, fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>단지 좌표 미리 예열하기</h1>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 20 }}>
        시/도 하나를 고르면 그 안의 모든 시/군/구를 순서대로 예열해요 (지역마다 몇 초~몇 십 초 걸릴 수 있어요).
        한 번 예열해두면, 그 지역은 이후 방문자 누구에게나 빠르게 나와요.
      </p>
      <button
        disabled={running}
        onClick={runAll}
        style={{
          padding: '10px 16px', borderRadius: 8, border: 'none', marginBottom: 16,
          background: running ? '#999' : '#B23A2E', color: '#fff', fontWeight: 700,
          cursor: running ? 'default' : 'pointer', fontSize: 14,
        }}
      >
        {running ? '예열 중...' : '🔥 전체 시/도 한번에 예열'}
      </button>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 20 }}>
        {REGION_GROUPS.map((g) => (
          <button
            key={g.sido}
            disabled={running}
            onClick={() => runSido(g)}
            style={{
              padding: '10px 8px', borderRadius: 8, border: '1px solid #ddd',
              background: running ? '#f2f2f2' : '#fff', cursor: running ? 'default' : 'pointer', fontSize: 13,
            }}
          >
            {g.sido} ({g.items.length}개 구/군)
            {summary[g.sido] && (
              <div style={{ fontSize: 10.5, color: summary[g.sido].found === summary[g.sido].total ? '#2e7d32' : '#b23a2e', marginTop: 3 }}>
                {summary[g.sido].found}/{summary[g.sido].total}개 확보
              </div>
            )}
          </button>
        ))}
      </div>
      {Object.keys(summary).length > 0 && (
        <div style={{ background: '#f7f5f0', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
          <b>누적 요약</b>: 전체 단지 {totals.total.toLocaleString()}개 중 좌표 확보 {totals.found.toLocaleString()}개
          · 좌표 미확보 {(totals.total - totals.found).toLocaleString()}개
          ({totals.total ? ((totals.found / totals.total) * 100).toFixed(1) : 0}% 완료)
        </div>
      )}
      {progress.total > 0 && (
        <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600 }}>
          진행: {progress.done} / {progress.total}
        </div>
      )}
      <div style={{
        background: '#111', color: '#0f0', fontFamily: 'monospace', fontSize: 12.5,
        padding: 14, borderRadius: 8, height: 360, overflowY: 'auto', whiteSpace: 'pre-wrap',
      }}
      >
        {log.length === 0 ? '(로그가 여기 표시됩니다)' : log.join('\n')}
      </div>
    </div>
  );
}

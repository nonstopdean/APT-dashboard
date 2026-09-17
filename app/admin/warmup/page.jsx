'use client';

import { useState } from 'react';
import { REGION_GROUPS } from '../../../lib/regions';

export default function WarmupPage() {
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const appendLog = (line) => setLog((prev) => [...prev, line]);

  const runSido = async (sido) => {
    if (running) return;
    setRunning(true);
    setLog([]);
    const items = sido.items;
    setProgress({ done: 0, total: items.length });
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
        }
      } catch (e) {
        appendLog(`❌ ${it.name}: 요청 실패 (${e.message})`);
      }
      setProgress({ done: i + 1, total: items.length });
    }
    appendLog('🎉 완료!');
    setRunning(false);
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24, fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>단지 좌표 미리 예열하기</h1>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 20 }}>
        시/도 하나를 고르면 그 안의 모든 시/군/구를 순서대로 예열해요 (지역마다 몇 초~몇 십 초 걸릴 수 있어요).
        한 번 예열해두면, 그 지역은 이후 방문자 누구에게나 빠르게 나와요.
      </p>
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
          </button>
        ))}
      </div>
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

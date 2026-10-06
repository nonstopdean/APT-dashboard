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
        // 서버가 시간 제한 안에서 멈추면(partial) 이어서 다시 부른다. 이미 저장된 단지는 건너뛰므로 여러 번 불러도 안전하다.
        let member = 0;
        let start = 0;
        let calls = 0;
        const acc = { totalComplexes: 0, found: 0, newlyFound: 0, notFound: 0, cached: 0 };
        let failed = null;
        for (;;) {
          calls += 1;
          // eslint-disable-next-line no-await-in-loop
          const res = await fetch(`/api/geocode-warmup?code=${it.code}&member=${member}&start=${start}`);
          // eslint-disable-next-line no-await-in-loop
          const json = await res.json();
          if (json.error) { failed = json.error; break; }
          // 새로 찾은 수와 못 찾은 수는 호출마다 서로 다른 단지라서 더한다.
          // "이미 저장돼 있던 수(cached)"는 첫 호출 것만 쓴다 — 이어서 부르면 앞 호출에서 새로 저장한 단지가
          // 다음 호출에서는 "이미 있음"으로 또 잡혀서, 매번 더하면 같은 단지가 중복으로 세어진다.
          acc.newlyFound += json.newlyFound || 0;
          acc.notFound += json.notFound || 0;
          if (calls === 1) { acc.cached = json.cached || 0; acc.totalComplexes = json.totalComplexes || 0; }
          if (!json.partial || !json.resume || calls >= 40) {
            acc.found = acc.cached + acc.newlyFound;
            break;
          }
          appendLog(`   ↻ ${it.name}: 시간 제한으로 잠시 멈췄어요. 이어서 진행합니다 (${calls}회차, 새로 ${acc.newlyFound}개)`);
          member = json.resume.member;
          start = json.resume.start;
        }
        if (failed) {
          appendLog(`❌ ${it.name}: ${failed}`);
        } else {
          appendLog(`✅ ${it.name}: 단지 ${acc.totalComplexes}개 중 ${acc.found}개 좌표 확보 (새로 ${acc.newlyFound} · 이미 있음 ${acc.cached} · 못 찾음 ${acc.notFound})`);
          sidoTotal += acc.totalComplexes;
          sidoFound += acc.found;
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

  // 예전 형식으로 저장된 좌표를 새 형식(이름 표기가 달라도 찾아지는 키)으로 복사한다. 여러 번 눌러도 안전하다.
  const runMigrate = async () => {
    if (running) return;
    setRunning(true);
    appendLog('🔁 기존 좌표 변환 시작... (옛 값은 지우지 않고, 이미 새 값이 있으면 덮어쓰지 않아요)');
    let cursor = '0';
    let scanned = 0;
    let created = 0;
    let bad = 0;
    let pages = 0;
    try {
      do {
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch(`/api/geocode-migrate?cursor=${encodeURIComponent(cursor)}&count=500`);
        // eslint-disable-next-line no-await-in-loop
        const json = await res.json();
        if (json.error) { appendLog(`❌ 변환 실패: ${json.error}`); break; }
        scanned += json.scanned || 0;
        created += json.created || 0;
        bad += json.bad || 0;
        cursor = json.cursor;
        pages += 1;
        if (pages % 5 === 0) appendLog(`   … ${scanned.toLocaleString()}개 확인, ${created.toLocaleString()}개 변환`);
      } while (cursor !== '0' && pages < 2000);
      if (cursor === '0') appendLog(`✅ 변환 완료: 옛 좌표 ${scanned.toLocaleString()}개 확인 → 새로 ${created.toLocaleString()}개 변환 (이상한 값 ${bad}개는 건너뜀)`);
    } catch (e) {
      appendLog(`❌ 변환 요청 실패 (${e.message})`);
    }
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
      <button
        disabled={running}
        onClick={runMigrate}
        title="예전에 저장된 좌표를, 단지 이름 표기가 조금 달라도(띄어쓰기·아파트 유무) 찾아지는 형식으로 복사해요. 한 번만 하면 되고, 여러 번 눌러도 안전해요."
        style={{
          padding: '10px 16px', borderRadius: 8, border: '1px solid #B23A2E', marginBottom: 16, marginLeft: 8,
          background: '#fff', color: running ? '#999' : '#B23A2E', fontWeight: 700,
          cursor: running ? 'default' : 'pointer', fontSize: 14,
        }}
      >
        🔁 기존 좌표 변환 (처음 1회)
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

'use client';

import React, { useEffect, useState } from 'react';

// 배포가 제대로 됐는지, 키가 설정됐는지, 저장소/좌표가 어떤 상태인지 한 화면에서 본다.
// (값은 절대 보여주지 않고 "설정됨/안 됨"만 보여준다.)
export default function HealthPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/health');
      setData(await res.json());
    } catch (e) {
      setError(`점검 요청에 실패했어요 (${e.message})`);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const mark = (ok) => (ok ? '✅' : '❌');
  const box = { border: '1px solid #E6E5E1', borderRadius: 10, padding: '12px 14px', marginBottom: 12, background: '#fff' };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px', fontFamily: 'sans-serif', fontSize: 14, lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>배포 상태 점검</h1>
      <p style={{ color: '#7A756C', margin: '0 0 16px' }}>
        키 값은 보여주지 않고 설정 여부만 보여줘요. <a href="/admin/warmup">좌표 예열 페이지</a>
      </p>
      <button onClick={load} disabled={loading} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #ccc', background: '#fff', cursor: 'pointer', marginBottom: 14 }}>
        {loading ? '확인 중...' : '다시 점검'}
      </button>
      {error && <div style={{ ...box, color: '#B23A2E' }}>{error}</div>}
      {data && (
        <>
          <div style={box} data-section="build">
            <b>빌드</b> <span data-build="1">{data.build}</span>
            <div style={{ color: '#7A756C', fontSize: 12 }}>지도 카드 맨 아래의 "빌드 vNNN"과 같으면 같은 버전이에요. 점검 시각 {data.checkedAt}</div>
          </div>

          <div style={box} data-section="env">
            <b>환경변수</b>
            {data.env.map((e) => (
              <div key={e.name} data-env={e.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, borderTop: '1px solid #F1F1EF', padding: '4px 0' }}>
                <span>{mark(e.set || !e.required)} {e.label} <code style={{ color: '#7A756C', fontSize: 11 }}>{e.name}</code></span>
                <span style={{ color: e.set ? '#2E7D32' : e.required ? '#B23A2E' : '#7A756C' }}>
                  {e.set ? '설정됨' : e.required ? '없음(필수)' : '없음(선택)'}
                </span>
              </div>
            ))}
          </div>

          <div style={box} data-section="kv">
            <b>저장소(Upstash)</b>
            {!data.kv.configured && <div style={{ color: '#B23A2E' }}>❌ 설정되지 않았어요. 좌표 예열과 서버 저장이 동작하지 않아요.</div>}
            {data.kv.configured && data.kv.ok && <div>✅ 연결됨 ({data.kv.latencyMs}ms)</div>}
            {data.kv.configured && data.kv.ok === false && <div style={{ color: '#B23A2E' }}>❌ 연결 실패: {data.kv.error}</div>}
          </div>

          {data.geocode && (
            <div style={box} data-section="geocode">
              <b>저장된 단지 좌표</b>
              {data.geocode.error ? (
                <div style={{ color: '#B23A2E' }}>❌ 개수를 세지 못했어요: {data.geocode.error}</div>
              ) : (
                <>
                  <div data-count="identity">새 형식(표기가 달라도 찾아짐): <b>{data.geocode.identity.count.toLocaleString()}</b>개{data.geocode.identity.truncated ? ' 이상' : ''}</div>
                  <div data-count="legacy">옛 형식: <b>{data.geocode.legacy.count.toLocaleString()}</b>개{data.geocode.legacy.truncated ? ' 이상' : ''}</div>
                  {data.geocode.needsMigration && (
                    <div data-hint="migrate" style={{ marginTop: 6, color: '#B23A2E' }}>
                      ⚠️ 옛 좌표만 있고 새 형식은 0개예요. <a href="/admin/warmup">좌표 예열 페이지</a>에서 "기존 좌표 변환"을 한 번 눌러주세요.
                    </div>
                  )}
                  {!data.geocode.needsMigration && data.geocode.identity.count === 0 && data.geocode.legacy.count === 0 && (
                    <div data-hint="empty" style={{ marginTop: 6, color: '#7A756C' }}>아직 저장된 좌표가 없어요. 좌표 예열을 돌리거나, 지도를 확대해서 보면 쌓여요.</div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

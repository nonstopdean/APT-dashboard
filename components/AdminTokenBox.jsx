'use client';

import React, { useEffect, useState } from 'react';

// v220: 관리자 페이지용 비밀 값 입력칸. 값은 이 탭에서만 기억한다(sessionStorage — 탭을 닫으면 지워짐).
// 서버에는 주소가 아니라 x-admin-token 헤더로만 보낸다(lib/admin-auth.js).
const STORE_KEY = 'apt-dashboard-admin-token';

export function useAdminToken() {
  const [token, setTokenState] = useState('');
  useEffect(() => {
    try { setTokenState(sessionStorage.getItem(STORE_KEY) || ''); } catch (e) { /* 저장소를 못 쓰면 매번 입력 */ }
  }, []);
  const setToken = (v) => {
    setTokenState(v);
    try { if (v) sessionStorage.setItem(STORE_KEY, v); else sessionStorage.removeItem(STORE_KEY); } catch (e) { /* 무시 */ }
  };
  const headers = token ? { 'x-admin-token': token } : {};
  return { token, setToken, headers };
}

export default function AdminTokenBox({ token, setToken, onSaved }) {
  const [draft, setDraft] = useState('');
  const box = { border: '1px solid #E6E5E1', borderRadius: 10, padding: '10px 12px', marginBottom: 14, background: '#fff', fontSize: 13 };
  if (token) {
    return (
      <div style={box} data-admin="on">
        🔓 관리자 비밀 값 입력됨 (이 탭을 닫으면 지워져요){' '}
        <button type="button" onClick={() => setToken('')} style={{ marginLeft: 6, padding: '3px 8px', borderRadius: 6, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}>지우기</button>
      </div>
    );
  }
  return (
    <form
      style={box}
      data-admin="off"
      onSubmit={(e) => { e.preventDefault(); const v = draft.trim(); if (v) { setToken(v); setDraft(''); if (onSaved) onSaved(v); } }}
    >
      <div style={{ marginBottom: 6 }}>🔒 Vercel 환경변수 <code>ADMIN_TOKEN</code>에 넣은 값을 입력해야 쓸 수 있어요.</div>
      <input
        type="password"
        autoComplete="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="관리자 비밀 값"
        style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc', width: 220, maxWidth: '60%' }}
      />
      <button type="submit" style={{ marginLeft: 6, padding: '6px 12px', borderRadius: 6, border: 'none', background: '#B23A2E', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>확인</button>
    </form>
  );
}

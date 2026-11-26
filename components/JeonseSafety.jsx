'use client';

import { useState } from 'react';
import { PALETTE, fmtWon, fmtArea } from '../lib/ui-helpers';
import { jeonseSafety } from '../lib/jeonse-ratio';

// v269: 단지 상세 "전세 안전진단"(하우스머치 참고). 평형(최근 12개월 매매·전세가 다 있는 면적)과 보증금·선순위 채무를 넣으면
// 같은 단지·같은 면적 매매 중간값 대비 비율과 위험 단계를 보여준다. 등기부(근저당)·공시가격 기준 보증보험 심사는 반영하지 않는 참고용.
const LEVELS = {
  safe: { label: '안전', color: '#15803D', bg: '#E8F7EE', desc: '매매가 대비 보증금 비율이 낮아요.' },
  normal: { label: '보통', color: '#1D4ED8', bg: '#EAF1FF', desc: '일반적인 수준이에요. 등기부등본은 꼭 확인하세요.' },
  caution: { label: '주의', color: '#B45309', bg: '#FFF4E0', desc: '집값이 조금만 내려도 보증금이 위험해질 수 있어요.' },
  danger: { label: '위험', color: '#B91C1C', bg: '#FDECEC', desc: '보증금이 매매가의 80%를 넘어요(깡통전세 위험). 보증보험 가입을 꼭 확인하세요.' },
};

export default function JeonseSafety({ gaps = [] }) {
  const usable = gaps.filter((g) => g.sale > 0);
  const [area, setArea] = useState(usable[0]?.area ?? null);
  const row = usable.find((g) => g.area === area) || usable[0];
  const [depEok, setDepEok] = useState(row ? String(Math.round(row.jeonse / 1000) / 10) : '');
  const [debtEok, setDebtEok] = useState('');
  if (!row) return null;
  const dep = Number(depEok) * 10000;
  const debt = Number(debtEok) * 10000;
  const r = jeonseSafety(dep, row.sale, debt);
  const lv = r ? LEVELS[r.level] : null;
  const input = { width: 90, border: `1px solid ${PALETTE.borderStrong}`, borderRadius: 8, padding: '6px 8px', fontSize: 13, textAlign: 'right' };

  return (
    <div data-jeonse-safety="1" style={{ marginBottom: 14, border: `1px solid ${PALETTE.border}`, borderRadius: 12, padding: 12, background: '#fff' }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8 }}>🛡️ 전세 안전진단 (참고용)</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          평형
          <select value={row.area} onChange={(e) => { const a = Number(e.target.value); setArea(a); const g = usable.find((x) => x.area === a); if (g) setDepEok(String(Math.round(g.jeonse / 1000) / 10)); }}
            style={{ border: `1px solid ${PALETTE.borderStrong}`, borderRadius: 8, padding: '6px 6px', fontSize: 12.5 }}>
            {usable.map((g) => <option key={g.area} value={g.area}>{fmtArea(g.area)}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          보증금 <input inputMode="decimal" value={depEok} onChange={(e) => setDepEok(e.target.value.replace(/[^\d.]/g, ''))} style={input} data-js-deposit="1" />억
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="집에 먼저 잡혀 있는 대출(근저당 채권최고액 등). 모르면 0">
          선순위 채무 <input inputMode="decimal" value={debtEok} placeholder="0" onChange={(e) => setDebtEok(e.target.value.replace(/[^\d.]/g, ''))} style={input} />억
        </label>
      </div>
      <div style={{ fontSize: 11, color: PALETTE.textMuted, marginTop: 6 }}>
        이 평형 최근 12개월 매매 중간값 <b style={{ color: PALETTE.textPrimary }}>{fmtWon(row.sale)}</b>({row.nSale}건) · 전세 중간값 {fmtWon(row.jeonse)}({row.nJeonse}건)
      </div>
      {r && lv ? (
        <div data-js-result={r.level} style={{ marginTop: 10, borderRadius: 10, padding: '10px 12px', background: lv.bg }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#fff', background: lv.color, borderRadius: 999, padding: '3px 10px' }}>{lv.label}</span>
            <b style={{ fontSize: 18, color: lv.color }}>{r.ratio.toFixed(0)}%</b>
            <span style={{ fontSize: 11.5, color: PALETTE.textSecondary }}>매매가 대비 (보증금{debt > 0 ? '+채무' : ''})</span>
          </div>
          {/* 0~100% 막대 + 60·70·80 기준선 */}
          <div style={{ position: 'relative', height: 8, borderRadius: 999, background: 'rgba(15,30,61,0.08)', marginTop: 8, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(100, r.ratio)}%`, background: lv.color, borderRadius: 999 }} />
            {[60, 70, 80].map((x) => <div key={x} style={{ position: 'absolute', left: `${x}%`, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.9)' }} />)}
          </div>
          <div style={{ fontSize: 11.5, color: PALETTE.textSecondary, marginTop: 8, lineHeight: 1.55 }}>
            {lv.desc}{' '}
            {r.exposed > 0
              ? <>보증금{debt > 0 ? '+채무' : ''}이 지금 매매 중간값보다 <b>{fmtWon(r.exposed)}</b> 많아요.</>
              : <>집값이 <b>{r.cushion.toFixed(0)}%</b> 넘게 떨어지면 보증금{debt > 0 ? '+채무' : ''}보다 낮아져요.</>}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: PALETTE.textMuted, marginTop: 8 }}>보증금을 억 단위로 넣어 주세요(예: 5.5).</div>
      )}
      <div style={{ fontSize: 10, color: PALETTE.textMuted, marginTop: 8, lineHeight: 1.5 }}>
        실거래 중간값 기준 참고 지표예요. 실제 계약 전에는 등기부등본(근저당·압류), 건축물대장, 전세보증보험 가입 가능 여부를 꼭 확인하세요.
      </div>
    </div>
  );
}

import HomeClient from './HomeClient';
import { regionLabel } from '../lib/regions';

// v279: 화면은 전부 HomeClient.jsx(클라이언트). 이 파일은 서버에서 공유 링크(?c=지역코드&d=동&a=단지명)의
// 미리보기 제목·설명만 단지 이름으로 바꿔 준다(카카오톡·문자 미리보기). 링크가 없으면 layout.jsx 기본값 그대로.
const clean = (v, max) => String(Array.isArray(v) ? v[0] : v || '')
  .replace(/[\u0000-\u001f<>]/g, '')
  .trim()
  .slice(0, max);

export function generateMetadata({ searchParams }) {
  const c = clean(searchParams?.c, 5);
  const a = clean(searchParams?.a, 40);
  const d = clean(searchParams?.d, 20);
  if (!/^\d{5}$/.test(c) || !a) return {};
  const regionName = regionLabel(c);
  const place = [regionName !== c ? regionName : '', d].filter(Boolean).join(' ');
  const title = `${a} 실거래가 · 도갱노노`;
  const description = `${place ? `${place} ` : ''}${a} 아파트 실거래가·전월세·시세 흐름을 지도에서 바로 확인하세요.`;
  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
  };
}

export default function Page() {
  return <HomeClient />;
}

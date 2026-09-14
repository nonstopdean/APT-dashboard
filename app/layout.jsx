export const metadata = {
  title: '아파트 실거래가 대시보드',
  description: '국토교통부 공개 데이터 기반 아파트 매매 실거래가 대시보드',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, background: '#12161D' }}>{children}</body>
    </html>
  );
}

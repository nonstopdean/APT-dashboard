export const metadata = {
  title: '아파트 실거래가 대시보드',
  description: '국토교통부 공개 데이터 기반 아파트 매매 실거래가 대시보드',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          as="style"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css"
        />
      </head>
      <body style={{ margin: 0, background: '#F5F5F3' }}>{children}</body>
    </html>
  );
}

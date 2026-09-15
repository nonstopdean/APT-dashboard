export const metadata = {
  title: '아파트 실거래가 대시보드',
  description: '국토교통부·한국부동산원 공공데이터 기반 아파트 실거래가·전월세·시세·청약 대시보드. 지도에서 단지를 클릭해 실거래 추이를 바로 확인하세요.',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
  },
  openGraph: {
    title: '아파트 실거래가 대시보드',
    description: '국토교통부·한국부동산원 공공데이터 기반 아파트 실거래가 대시보드',
    type: 'website',
  },
};

export const viewport = {
  themeColor: '#EF4444',
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
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body style={{ margin: 0, background: '#F5F5F3' }}>{children}</body>
    </html>
  );
}

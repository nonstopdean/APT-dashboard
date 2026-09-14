'use client';
import { useState } from 'react';
import KakaoMap from '@/components/KakaoMap';

export default function Page() {
  const [selectedComplex, setSelectedComplex] = useState(null); // 모달에 띄울 단지명

  // 단지 클릭 또는 마커 클릭 시 실행될 함수
  const handleOpenModal = (complexName) => {
    setSelectedComplex(complexName);
  };

  return (
    <main className="flex flex-col h-screen p-4 bg-gray-50">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">🏠 부동산 실거래가 대시보드</h1>
      </header>

      {/* 메인 콘텐츠 영역: 좌측 목록, 우측 지도 분할 */}
      <div className="flex flex-1 gap-4 overflow-hidden">
        {/* 좌측: 단지 목록 영역 */}
        <div className="w-1/2 bg-white p-4 rounded-lg shadow overflow-y-auto">
          <h2 className="text-lg font-semibold mb-3">최근 거래 단지 목록</h2>
          {/* 예시 단지 아이템 (기존 목록 코드를 여기에 배치하시면 됩니다) */}
          <div 
            onClick={() => handleOpenModal('래미안 ○○아파트')}
            className="p-3 mb-2 border rounded cursor-pointer hover:bg-blue-50 transition"
          >
            <p className="font-bold">래미안 ○○아파트</p>
            <p className="text-sm text-gray-500">매매 · 6억 8,000만원</p>
          </div>
          <div 
            onClick={() => handleOpenModal('△△아파트')}
            className="p-3 mb-2 border rounded cursor-pointer hover:bg-blue-50 transition"
          >
            <p className="font-bold">△△아파트</p>
            <p className="text-sm text-gray-500">전세 · 4억 5,000만원</p>
          </div>
        </div>

        {/* 우측: 카카오맵 영역 */}
        <div className="w-1/2 bg-white p-4 rounded-lg shadow flex flex-col">
          <h2 className="text-lg font-semibold mb-3">지도 보기</h2>
          <div className="flex-1">
            <KakaoMap onMarkerClick={handleOpenModal} />
          </div>
        </div>
      </div>

      {/* 모달 창 (selectedComplex가 존재할 때만 팝업으로 표시) */}
      {selectedComplex && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-[500px] max-h-[80vh] overflow-y-auto shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">🏢 {selectedComplex} 최근 거래 내역</h2>
              <button 
                onClick={() => setSelectedComplex(null)}
                className="text-gray-500 hover:text-black text-lg font-bold"
              >
                ✕
              </button>
            </div>
            <p className="text-gray-600 mb-4">이곳에 해당 단지의 상세 거래 내역 데이터가 쫙 펼쳐집니다.</p>
            {/* 상세 거래 내역 테이블 또는 리스트 컴포넌트 위치 */}
            <div className="flex justify-end">
              <button 
                onClick={() => setSelectedComplex(null)}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

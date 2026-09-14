'use client';
import { useState } from 'react';
import KakaoMap from '@/components/KaKaoMap'; // 방금 만든 카카오맵 컴포넌트

export default function Page() {
  // 기존 대시보드 상태 관리
  const [tradeType, setTradeType] = useState('trade'); // 'trade': 매매, 'rent': 전월세
  const [period, setPeriod] = useState(6); // 조회 기간 (개월)
  const [selectedRegion, setSelectedRegion] = useState('서울 전체');
  
  // 모달 제어를 위한 상태 (목록이나 마커 클릭 시 동작)
  const [selectedComplex, setSelectedComplex] = useState(null);

  const handleOpenModal = (complexName) => {
    setSelectedComplex(complexName);
  };

  return (
    <main className="flex flex-col h-screen p-4 bg-gray-50 overflow-hidden">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">🏠 아파트 실거래가 대시보드</h1>
        <p className="text-sm text-gray-500">국토교통부 실거래가 공개자료 기반. 접속할 때마다 서버가 최신 데이터를 가져옵니다.</p>
      </header>

      {/* 메인 콘텐츠 영역: 좌측 컨트롤/목록 패널, 우측 카카오맵 */}
      <div className="flex flex-1 gap-4 overflow-hidden">
        
        {/* 좌측 패널: 기존 컨트롤 및 조회 영역 */}
        <div className="w-1/3 bg-white p-4 rounded-lg shadow flex flex-col overflow-y-auto gap-4">
          
          {/* 거래 유형 선택 */}
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">거래 유형</label>
            <div className="flex gap-2">
              <button 
                onClick={() => setTradeType('trade')}
                className={`flex-1 py-2 border rounded font-medium text-sm transition ${tradeType === 'trade' ? 'border-red-500 text-red-500 bg-red-50' : 'text-gray-600'}`}
              >
                매매
              </button>
              <button 
                onClick={() => setTradeType('rent')}
                className={`flex-1 py-2 border rounded font-medium text-sm transition ${tradeType === 'rent' ? 'border-red-500 text-red-500 bg-red-50' : 'text-gray-600'}`}
              >
                전월세
              </button>
            </div>
          </div>

          {/* 조회 기간 선택 */}
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">조회 기간</label>
            <div className="flex gap-2">
              {[3, 6, 12].map((m) => (
                <button
                  key={m}
                  onClick={() => setPeriod(m)}
                  className={`flex-1 py-1.5 border rounded text-xs transition ${period === m ? 'border-red-500 text-red-500 bg-red-50' : 'text-gray-600'}`}
                >
                  최근 {m}개월
                </button>
              ))}
            </div>
          </div>

          {/* 지역 선택 */}
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">지역 추가 (전국)</label>
            <select 
              value={selectedRegion}
              onChange={(e) => setSelectedRegion(e.target.value)}
              className="w-full p-2 border rounded text-sm mb-2"
            >
              <option value="서울 전체">서울 전체</option>
              <option value="부산 전체">부산 전체</option>
              <option value="대구 전체">대구 전체</option>
              <option value="인천 전체">인천 전체</option>
            </select>
            <div className="p-2 bg-gray-100 rounded text-xs text-gray-600 flex justify-between items-center">
              <span>{selectedRegion}</span>
              <span className="text-red-500 font-bold cursor-pointer" onClick={() => setSelectedRegion('선택 안함')}>✕</span>
            </div>
          </div>

          {/* 데이터 조회 버튼 */}
          <button className="w-full py-3 bg-[#b93737] text-white rounded font-bold hover:bg-[#a02f2f] transition mt-auto">
            데이터 조회
          </button>
        </div>

        {/* 우측 영역: 분할하여 위쪽은 대시보드 시황/목록, 아래쪽은 카카오맵 (혹은 반반 배치) */}
        <div className="w-2/3 flex flex-col gap-4">
          
          {/* 상단: 단지 목록 (예시 데이터 연동) */}
          <div className="h-1/2 bg-white p-4 rounded-lg shadow overflow-y-auto flex flex-col">
            <h2 className="text-lg font-semibold mb-2">📍 주변 단지 목록</h2>
            <p className="text-xs text-gray-400 mb-3">목록의 단지를 클릭하거나 우측 지도의 마커를 클릭해 보세요.</p>
            
            <div 
              onClick={() => handleOpenModal('래미안 ○○아파트')}
              className="p-3 mb-2 border rounded cursor-pointer hover:bg-blue-50 transition flex justify-between items-center"
            >
              <div>
                <p className="font-bold text-sm">래미안 ○○아파트</p>
                <p className="text-xs text-gray-500">매매 · 84㎡ · 6억 8,000만원</p>
              </div>
              <span className="text-xs text-blue-600 font-semibold">상세보기 &gt;</span>
            </div>

            <div 
              onClick={() => handleOpenModal('△△아파트')}
              className="p-3 mb-2 border rounded cursor-pointer hover:bg-blue-50 transition flex justify-between items-center"
            >
              <div>
                <p className="font-bold text-sm">△△아파트</p>
                <p className="text-xs text-gray-500">전세 · 59㎡ · 4억 5,000만원</p>
              </div>
              <span className="text-xs text-blue-600 font-semibold">상세보기 &gt;</span>
            </div>
          </div>

          {/* 하단: 카카오맵 컴포넌트 */}
          <div className="h-1/2 bg-white p-4 rounded-lg shadow flex flex-col">
            <h2 className="text-lg font-semibold mb-2">🗺️ 지도 보기</h2>
            <div className="flex-1 w-full h-full relative overflow-hidden rounded">
              <KakaoMap onMarkerClick={handleOpenModal} />
            </div>
          </div>

        </div>
      </div>

      {/* 모달 창 (목록 혹은 마커 클릭 시 동일하게 동작) */}
      {selectedComplex && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-[600px] max-h-[80vh] overflow-y-auto shadow-xl">
            <div className="flex justify-between items-center mb-4 border-b pb-2">
              <h2 className="text-xl font-bold">🏢 {selectedComplex} 실거래 상세 내역</h2>
              <button 
                onClick={() => setSelectedComplex(null)}
                className="text-gray-500 hover:text-black text-xl font-bold"
              >
                ✕
              </button>
            </div>
            
            <p className="text-sm text-gray-600 mb-4">
              선택하신 단지의 국토교통부 실제 거래 계약일, 면적, 층수 및 가격 변동 내역이 이곳에 표시됩니다.
            </p>

            {/* 임시 상세 테이블 */}
            <table className="w-full text-left text-sm mb-4 border-collapse">
              <thead>
                <tr className="bg-gray-100 text-gray-600">
                  <th className="p-2 border">계약일</th>
                  <th className="p-2 border">금액</th>
                  <th className="p-2 border">면적</th>
                  <th className="p-2 border">층</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="p-2 border">2026.05.12</td>
                  <td className="p-2 border font-bold text-red-500">6억 8,000만</td>
                  <td className="p-2 border">84.9㎡</td>
                  <td className="p-2 border">12층</td>
                </tr>
                <tr>
                  <td className="p-2 border">2026.04.01</td>
                  <td className="p-2 border font-bold text-red-500">6억 5,000만</td>
                  <td className="p-2 border">84.9㎡</td>
                  <td className="p-2 border">7층</td>
                </tr>
              </tbody>
            </table>

            <div className="flex justify-end">
              <button 
                onClick={() => setSelectedComplex(null)}
                className="px-4 py-2 bg-gray-800 text-white rounded text-sm hover:bg-black transition"
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

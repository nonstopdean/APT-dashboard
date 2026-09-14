'use client';
import { useEffect } from 'react';

export default function KakaoMap({ onMarkerClick }) {
  useEffect(() => {
    const kakaoMapKey = "a8cea2ec3ad7bd7a42bd91ff6f1b230b"; // 발급받으신 자바스크립트 키
    
    // 이미 스크립트가 로드되어 있지 않은 경우에만 동적으로 추가
    if (!document.getElementById('kakao-map-script')) {
      const script = document.createElement('script');
      script.id = 'kakao-map-script';
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${kakaoMapKey}&autoload=false`;
      script.async = true;

      script.onload = () => {
        window.kakao.maps.load(() => {
          initMap();
        });
      };
      document.head.appendChild(script);
    } else {
      if (window.kakao && window.kakao.maps) {
        window.kakao.maps.load(() => {
          initMap();
        });
      }
    }

    function initMap() {
      const container = document.getElementById('map');
      const options = {
        center: new window.kakao.maps.LatLng(37.566826, 126.978656), // 서울 중심 (원하시는 지역 좌표로 변경 가능)
        level: 5
      };
      const map = new window.kakao.maps.Map(container, options);

      // 테스트용 아파트 마커 데이터 (나중에는 실제 단지 데이터와 연동)
      const positions = [
        { title: '래미안 ○○아파트', lat: 37.565, lng: 126.97 },
        { title: '△△아파트', lat: 37.570, lng: 126.98 }
      ];

      positions.forEach(pos => {
        const markerPosition = new window.kakao.maps.LatLng(pos.lat, pos.lng);
        const marker = new window.kakao.maps.Marker({
          position: markerPosition,
          title: pos.title
        });
        marker.setMap(map);

        // 마커 클릭 시 단지명 전달 (모달 오픈용)
        window.kakao.maps.event.addListener(marker, 'click', () => {
          if (onMarkerClick) {
            onMarkerClick(pos.title);
          }
        });
      });
    }
  }, [onMarkerClick]);

  return <div id="map" className="w-full h-full min-h-[400px] rounded-lg shadow-inner" />;
}

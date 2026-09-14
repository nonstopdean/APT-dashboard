# 아파트 실거래가 대시보드 (배포용)

국토교통부 "아파트 매매 실거래가 자료" 공개 API를 서버(Next.js API Route)에서 대신 호출해서
브라우저의 CORS 제약 없이 보여주는 대시보드입니다. 개인/비상업 용도로 무료 배포가 가능합니다.

## 로컬에서 먼저 테스트 (선택)

```bash
npm install
cp .env.local.example .env.local
# .env.local 파일을 열어서 MOLIT_SERVICE_KEY 값을 채워넣기
npm run dev
```

브라우저에서 http://localhost:3000 접속해서 정상 작동하는지 확인합니다.

## 실제 배포하기 (GitHub + Vercel)

### 1. GitHub에 코드 올리기

이 폴더에서:

```bash
git init
git add .
git commit -m "init: apt market dashboard"
```

GitHub에서 새 저장소를 만든 뒤 (Private 선택 가능), 안내되는 명령어로 push:

```bash
git remote add origin <본인의 저장소 URL>
git branch -M main
git push -u origin main
```

`.env.local`은 `.gitignore`에 포함되어 있어 절대 GitHub에 올라가지 않습니다. 서비스키는
안전합니다.

### 2. Vercel에 배포

1. https://vercel.com 에서 GitHub 계정으로 로그인
2. "Add New..." → "Project" → 방금 올린 저장소 선택
3. Framework Preset은 Next.js가 자동 감지됩니다. 그대로 진행
4. 배포 전에 "Environment Variables" 항목에 아래를 추가:
   - Key: `MOLIT_SERVICE_KEY`
   - Value: 공공데이터포털에서 발급받은 서비스키 (Decoding 형태)
5. "Deploy" 클릭 → 1~2분 후 `https://프로젝트명.vercel.app` 형태의 실제 URL 생성

이후로는 이 URL로 접속할 때마다 서버가 국토부 API를 대신 호출해서 최신 데이터를 보여줍니다.

### 3. 코드 수정 후 재배포

코드를 고치고 싶으면 파일을 수정한 뒤:

```bash
git add .
git commit -m "수정 내용"
git push
```

Vercel이 push를 감지해서 자동으로 재배포합니다.

## 전월세(전세/월세) 데이터 사용하려면

대시보드 왼쪽에서 "전월세"를 선택하면 `/api/rents`가 호출되는데, 이건 매매와
**다른 데이터셋**이라 공공데이터포털에서 별도로 활용신청이 필요할 수 있습니다.

1. data.go.kr에서 **"국토교통부_아파트 전월세 실거래가 자료"** 검색
2. 해당 데이터 페이지에서 **활용신청** (자동승인)
3. 이미 매매 API에 쓰던 서비스키를 그대로 쓰면 됩니다 (계정은 같고, 데이터셋별 승인만 추가되는
   구조입니다)

전월세 선택 시 "등록되지 않은 서비스키" 같은 에러가 뜨면, 이 활용신청을 아직 안 하셨을
가능성이 가장 높습니다.

## 참고 및 주의사항

- **무료 사용량**: 이 API는 개발계정 기준 하루 트래픽 한도가 있습니다 (보통 10,000건). 개인
  사용으로는 충분합니다.
- **응답 시간**: Vercel 무료(Hobby) 플랜은 서버 함수 실행 시간이 최대 10초로 제한됩니다.
  지역을 너무 많이 선택하거나 기간을 12개월로 길게 잡으면 타임아웃이 날 수 있어요. 처음엔
  지역 3~5개, 기간 6개월 정도로 테스트해보세요.
- **비상업적 용도**: 국토교통부 실거래가 데이터는 공공데이터포털 이용약관에 따라 이용해야
  합니다. 개인적으로 시세를 확인하는 용도로는 문제없지만, 이 데이터를 유료 서비스나 재판매
  형태로 활용하려면 별도로 이용약관과 활용신청 조건을 다시 확인하세요.
- **서울 외 지역**: 기본으로 서울 25개 자치구 코드만 정확히 넣어뒀습니다. 다른 지역은
  code.go.kr에서 법정동코드 앞 5자리를 확인해서 대시보드의 "지역 코드 직접 추가"로
  넣으면 됩니다.

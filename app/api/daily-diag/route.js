import { fetchRtms, rtmsErrorOf } from '../../../lib/molit';
import { monthsToFetch } from '../../../lib/daily-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// v261: 일일 신고 크론 진단. 11/24·11/25 크론에서 경기 지역 대부분이 실패했는데(사이트 조회는 정상) 이유가 기록되지 않았다.
// 정해진 몇 곳만 저장본 없이(fresh) 국토부에 직접 물어 걸린 시간·건수·결과 코드만 돌려준다(키·주소·원문은 넣지 않는다).
// 같은 결과를 2분 동안 CDN이 돌려줘 반복 호출로 국토부 한도를 쓰지 않게 한다.
const SAMPLE = ['41111', '41463', '41281', '11710', '28237'];
const LIMIT_MS = 25000;

const errCode = (msg) => {
  if (!msg) return null;
  const up = String(msg).match(/[A-Z_][A-Z0-9_ .]{3,60}/);
  return up ? up[0].trim().slice(0, 60) : '오류 응답';
};

export async function GET() {
  const serviceKey = (process.env.MOLIT_SERVICE_KEY || '').trim();
  if (!serviceKey) return Response.json({ error: '서버 설정이 필요해요.' }, { status: 500 });
  const ym = monthsToFetch().slice(-2)[0];
  const started = Date.now();
  const results = await Promise.all(SAMPLE.map(async (code) => {
    const t0 = Date.now();
    const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade`
      + `?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=${code}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=1`;
    try {
      const out = await Promise.race([
        fetchRtms(url, ym, true).then((r) => r.text()),
        new Promise((resolve) => { setTimeout(() => resolve(null), LIMIT_MS); }),
      ]);
      if (out == null) return { code, ms: Date.now() - t0, result: 'timeout' };
      const total = Number((out.match(/<totalCount>\s*(\d+)\s*</) || [])[1] || 0);
      const err = rtmsErrorOf(out);
      return { code, ms: Date.now() - t0, result: err ? 'error' : 'ok', errCode: errCode(err), totalCount: total, bytes: out.length };
    } catch (e) {
      return { code, ms: Date.now() - t0, result: 'throw', errName: String(e?.name || 'Error').slice(0, 30) };
    }
  }));
  return Response.json({ ym, ms: Date.now() - started, results }, {
    headers: { 'Cache-Control': 'public, s-maxage=120' },
  });
}

import { fetchRegionMonth, runPool, lastNMonths } from '../../../lib/molit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const codes = (searchParams.get('codes') || '').split(',').map((c) => c.trim()).filter(Boolean);
  const monthCount = Math.min(Math.max(parseInt(searchParams.get('months') || '6', 10), 1), 12);

  const serviceKey = process.env.MOLIT_SERVICE_KEY;
  if (!serviceKey) {
    return Response.json(
      { error: '서버에 MOLIT_SERVICE_KEY 환경변수가 설정되지 않았습니다.' },
      { status: 500 },
    );
  }
  if (codes.length === 0) {
    return Response.json({ error: '지역 코드가 1개 이상 필요합니다.' }, { status: 400 });
  }
  if (codes.length * monthCount > 80) {
    return Response.json(
      { error: `요청 건수(${codes.length * monthCount})가 너무 많습니다. 지역 수나 기간을 줄여주세요.` },
      { status: 400 },
    );
  }

  const months = lastNMonths(monthCount);
  const keys = [];
  const tasks = [];
  codes.forEach((code) => {
    months.forEach((ym) => {
      keys.push(`${code}_${ym}`);
      tasks.push(() => fetchRegionMonth(serviceKey, code, ym));
    });
  });

  const results = await runPool(tasks, 6);

  const data = {};
  let errorMsg = null;
  results.forEach((r, i) => {
    if (r && r.error) {
      errorMsg = errorMsg || r.error.message;
      data[keys[i]] = [];
    } else {
      data[keys[i]] = r || [];
    }
  });

  return Response.json({ data, months, error: errorMsg, fetchedAt: new Date().toISOString() });
}

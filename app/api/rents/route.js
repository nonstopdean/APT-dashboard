import { fetchRegionMonthRent, runPool, lastNMonths } from '../../../lib/molit';
import { expandRegionCode } from '../../../lib/regions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const codes = (searchParams.get('codes') || '').split(',').map((c) => c.trim()).filter(Boolean);
  const monthCount = Math.min(Math.max(parseInt(searchParams.get('months') || '6', 10), 1), 12);

  const serviceKey = (process.env.MOLIT_SERVICE_KEY || '').trim();
  if (!serviceKey) {
    return Response.json(
      { error: '서버에 MOLIT_SERVICE_KEY 환경변수가 설정되지 않았습니다.' },
      { status: 500 },
    );
  }
  if (codes.length === 0) {
    return Response.json({ error: '지역 코드가 1개 이상 필요합니다.' }, { status: 400 });
  }

  const expansion = {};
  codes.forEach((code) => {
    expansion[code] = expandRegionCode(code);
  });

  const memberSet = new Set();
  Object.values(expansion).forEach((arr) => arr.forEach((c) => memberSet.add(c)));
  const members = [...memberSet];

  const totalCalls = members.length * monthCount;
  if (totalCalls > 400) {
    return Response.json(
      { error: `실제 호출 건수(${totalCalls})가 너무 많습니다. 시/도 전체 선택 시에는 기간을 3~6개월 정도로 줄여주세요.` },
      { status: 400 },
    );
  }

  const months = lastNMonths(monthCount);
  const keys = [];
  const tasks = [];
  members.forEach((code) => {
    months.forEach((ym) => {
      keys.push(`${code}_${ym}`);
      tasks.push(() => fetchRegionMonthRent(serviceKey, code, ym));
    });
  });

  const results = await runPool(tasks, 10);

  const rawByMember = {};
  let errorMsg = null;
  results.forEach((r, i) => {
    if (r && r.error) {
      errorMsg = errorMsg || r.error.message;
      rawByMember[keys[i]] = [];
    } else {
      rawByMember[keys[i]] = r || [];
    }
  });

  const data = {};
  codes.forEach((code) => {
    months.forEach((ym) => {
      const combined = [];
      expansion[code].forEach((mc) => combined.push(...(rawByMember[`${mc}_${ym}`] || [])));
      data[`${code}_${ym}`] = combined;
    });
  });
  members.forEach((mc) => {
    months.forEach((ym) => {
      const key = `${mc}_${ym}`;
      if (!(key in data)) data[key] = rawByMember[key] || [];
    });
  });

  return Response.json({ data, months, error: errorMsg, fetchedAt: new Date().toISOString() });
}

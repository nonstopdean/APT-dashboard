import { fetchRegionMonth, runPool, lastNMonths, monthsBetween } from '../../../lib/molit';
import { expandRegionCode } from '../../../lib/regions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const codes = (searchParams.get('codes') || '').split(',').map((c) => c.trim()).filter(Boolean);
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');

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

  let months;
  if (startParam && endParam && /^\d{6}$/.test(startParam) && /^\d{6}$/.test(endParam)) {
    months = monthsBetween(startParam, endParam);
    if (months.length === 0) {
      return Response.json({ error: '시작월이 종료월보다 이후입니다.' }, { status: 400 });
    }
  } else {
    const monthCount = Math.min(Math.max(parseInt(searchParams.get('months') || '6', 10), 1), 24);
    months = lastNMonths(monthCount);
  }
  if (months.length > 240) {
    return Response.json({ error: `기간이 너무 깁니다 (${months.length}개월). 240개월(20년) 이하로 설정해주세요.` }, { status: 400 });
  }

  // 시/도 전체(가상 코드)는 실제로 그 시/도의 모든 시/군/구를 대신 호출해야 하므로
  // 여기서 실호출 대상 코드로 펼친다.
  const expansion = {};
  codes.forEach((code) => {
    expansion[code] = expandRegionCode(code);
  });

  const memberSet = new Set();
  Object.values(expansion).forEach((arr) => arr.forEach((c) => memberSet.add(c)));
  const members = [...memberSet];

  const totalCalls = members.length * months.length;
  if (totalCalls > 400) {
    return Response.json(
      { error: `실제 호출 건수(${totalCalls})가 너무 많습니다. 시/도 전체 선택 시에는 기간을 짧게 줄여주세요.` },
      { status: 400 },
    );
  }

  const keys = [];
  const tasks = [];
  members.forEach((code) => {
    months.forEach((ym) => {
      keys.push(`${code}_${ym}`);
      tasks.push(() => fetchRegionMonth(serviceKey, code, ym));
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
  // 지도 등에서 구 단위 값이 필요할 수 있어, 이미 불러온 개별 시/군/구 데이터도 함께 내려준다
  // (추가 호출 없이 이미 fetch한 결과를 재사용).
  members.forEach((mc) => {
    months.forEach((ym) => {
      const key = `${mc}_${ym}`;
      if (!(key in data)) data[key] = rawByMember[key] || [];
    });
  });

  return Response.json({ data, months, error: errorMsg, fetchedAt: new Date().toISOString() });
}

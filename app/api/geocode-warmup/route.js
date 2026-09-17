import { fetchAptListBySigungu, geocodeViaKakaoRest } from '../../../lib/molit';
import { kvReady, kvMSet } from '../../../lib/kv';
import { expandRegionCode, regionLabel } from '../../../lib/regions';
import { runPool } from '../../../lib/geocodeCache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PREFIX = 'geo:';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = (searchParams.get('code') || '').trim();

  const molitKey = (process.env.MOLIT_SERVICE_KEY || '').trim();
  const kakaoRestKey = (process.env.KAKAO_REST_API_KEY || '').trim();
  if (!molitKey) {
    return Response.json({ error: 'MOLIT_SERVICE_KEY 환경변수가 없습니다.' }, { status: 500 });
  }
  if (!kakaoRestKey) {
    return Response.json({ error: 'KAKAO_REST_API_KEY 환경변수가 없습니다.' }, { status: 500 });
  }
  if (!kvReady()) {
    return Response.json({ error: 'Vercel KV(저장소)가 설정되어 있지 않습니다.' }, { status: 500 });
  }
  if (!code) {
    return Response.json({ error: 'code(지역 코드)가 필요합니다. 예: ?code=11680' }, { status: 400 });
  }

  const members = expandRegionCode(code);
  let totalComplexes = 0;
  let found = 0;
  const perRegion = [];

  for (const regionCode of members) {
    // eslint-disable-next-line no-await-in-loop
    const list = await fetchAptListBySigungu(molitKey, regionCode);
    const regionName = regionLabel(regionCode);
    totalComplexes += list.length;

    const entries = [];
    // eslint-disable-next-line no-await-in-loop
    await runPool(list, async (item) => {
      const key = `${regionCode}|${item.dong}|${item.kaptName}`;
      const coord = await geocodeViaKakaoRest(kakaoRestKey, `${regionName} ${item.dong} ${item.kaptName}`)
        || await geocodeViaKakaoRest(kakaoRestKey, `${item.dong} ${item.kaptName}`)
        || await geocodeViaKakaoRest(kakaoRestKey, item.kaptName);
      if (coord) {
        entries.push([PREFIX + key, coord]);
        found += 1;
      }
    }, 8);

    // eslint-disable-next-line no-await-in-loop
    await kvMSet(entries);
    perRegion.push({ regionCode, regionName, complexCount: list.length, found: entries.length });
  }

  return Response.json({ totalComplexes, found, perRegion });
}

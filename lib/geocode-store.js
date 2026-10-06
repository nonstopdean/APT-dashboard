import { kvMGet, kvMSet, kvMSetNX, kvScan } from './kv';
import { complexIdentity } from './complex-name';
import { plausibleForRegion } from './geocode-pick';

// 단지 좌표를 서버(KV)에 저장·조회하는 유일한 통로. 조회·저장·예열이 전부 여기를 거친다.
//
// 왜 필요한가: 예열은 K-apt 단지명, 지도는 실거래 단지명으로 키를 만들어서 표기가 조금만 달라도
// ("목동신시가지 1단지" / "목동신시가지1단지") 예열해둔 좌표가 쓰이지 않았다. 그래서 키를
// "지역|동|정규화한 이름"(identity)으로 통일해서 저장하고, 조회할 때는 identity 키와 옛 키(legacy)를 둘 다 본다.
//   geoi:<지역>|<동>|<정규화 이름>   ← 새 형식. 앞으로의 저장은 전부 여기에.
//   geo:<지역>|<동>|<이름>           ← 옛 형식. 읽기만 하고(마이그레이션 대상), 새로 쓰지 않는다.
export const LEGACY_PREFIX = 'geo:';
export const IDENT_PREFIX = 'geoi:';
export const MIGRATION_MARKER = 'geocode:migration'; // 옛 좌표 변환을 끝까지 마쳤다는 표시

const KOREA = { latMin: 32.5, latMax: 39.0, lngMin: 124.0, lngMax: 132.5 };
export const isValidCoord = (c) => !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng)
  && c.lat >= KOREA.latMin && c.lat <= KOREA.latMax && c.lng >= KOREA.lngMin && c.lng <= KOREA.lngMax;

// "지역코드|동|단지명" → 세 조각. 단지명 안에 '|'가 있어도 앞 두 개만 구분자로 본다.
export function splitComplexKey(key) {
  const s = String(key || '');
  const i = s.indexOf('|');
  const j = i < 0 ? -1 : s.indexOf('|', i + 1);
  if (i < 0 || j < 0) return null;
  return { regionCode: s.slice(0, i), dong: s.slice(i + 1, j), apt: s.slice(j + 1) };
}

// 키의 지역코드가 속한 시·도 범위 안의 좌표만 믿는다(옛 예열이 이름만 같은 다른 도시 좌표를 저장해 둔 경우가 있다).
export function plausibleForKey(key, coord) {
  const p = splitComplexKey(key);
  return !p || plausibleForRegion(p.regionCode, coord);
}

export function identityKeyOf(key) {
  const p = splitComplexKey(key);
  if (!p || !p.apt) return null;
  return complexIdentity(p.regionCode, p.dong, p.apt);
}

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

// keys: 지도/예열이 쓰는 단지 키 목록. 반환: { data: { [요청한 키]: {lat,lng} }, stats }.
//  - identity 키가 있으면 그걸 우선한다(검증된 최신값이고, 표기가 달라도 맞는다).
//  - 없으면 옛 키로 찾고, 찾았으면 identity 키로 복사해 둔다(다음부터는 표기가 달라도 맞게 — 값이 이미 있으면 덮어쓰지 않는다).
export async function readCoords(keys, { migrate = true } = {}) {
  const wanted = (keys || []).filter(Boolean);
  const kvKeys = new Set();
  const plan = wanted.map((key) => {
    const id = identityKeyOf(key);
    const idKv = id ? IDENT_PREFIX + id : null;
    const lgKv = LEGACY_PREFIX + key;
    if (idKv) kvKeys.add(idKv);
    kvKeys.add(lgKv);
    return { key, idKv, lgKv };
  });
  const hits = {};
  // 한 번에 보내는 명령 수를 제한한다(identity+옛 키라 요청당 최대 2배가 된다).
  // eslint-disable-next-line no-restricted-syntax
  for (const part of chunk([...kvKeys], 1000)) {
    // eslint-disable-next-line no-await-in-loop
    Object.assign(hits, await kvMGet(part));
  }
  const data = {};
  const toCopy = new Map();
  let viaIdentity = 0;
  let viaLegacy = 0;
  let rejected = 0; // 다른 시·도 좌표라서 믿지 않은 수
  plan.forEach(({ key, idKv, lgKv }) => {
    const idVal = idKv ? hits[idKv] : null;
    if (isValidCoord(idVal)) {
      if (plausibleForKey(key, idVal)) { data[key] = { lat: idVal.lat, lng: idVal.lng }; viaIdentity += 1; return; }
      rejected += 1;
    }
    const lgVal = hits[lgKv];
    if (isValidCoord(lgVal)) {
      if (!plausibleForKey(key, lgVal)) { rejected += 1; return; }
      data[key] = { lat: lgVal.lat, lng: lgVal.lng };
      viaLegacy += 1;
      if (idKv) toCopy.set(idKv, { lat: lgVal.lat, lng: lgVal.lng });
    }
  });
  let copied = 0;
  if (migrate && toCopy.size > 0) {
    try { copied = await kvMSetNX([...toCopy]); } catch (e) { /* 복사는 부가 기능 — 실패해도 조회 결과는 그대로 돌려준다 */ }
  }
  return { data, stats: { asked: wanted.length, hit: Object.keys(data).length, viaIdentity, viaLegacy, copied, rejected } };
}

// entries: [{ key, lat, lng }]. identity 키로 저장한다(같은 단지의 값은 덮어써서, 잘못 저장돼 있던 값이 고쳐진다).
export async function writeCoords(entries) {
  const byKv = new Map();
  (entries || []).forEach((e) => {
    if (!e?.key || !isValidCoord(e) || !plausibleForKey(e.key, e)) return; // 다른 시·도 좌표는 공유 캐시에 저장하지 않는다
    const id = identityKeyOf(e.key);
    byKv.set(id ? IDENT_PREFIX + id : LEGACY_PREFIX + e.key, { lat: e.lat, lng: e.lng });
  });
  const list = [...byKv];
  // eslint-disable-next-line no-restricted-syntax
  for (const part of chunk(list, 500)) {
    // eslint-disable-next-line no-await-in-loop
    await kvMSet(part);
  }
  return list.length;
}

// 옛 키(geo:)를 한 페이지 훑어서 identity 키(geoi:)로 복사한다. 이미 identity 값이 있으면 건드리지 않는다.
// 반환한 cursor가 '0'이면 끝. 관리자 페이지가 '0'이 될 때까지 반복해서 부른다.
export async function migrateLegacyPage(cursor = '0', count = 500) {
  const [next, keys] = await kvScan(cursor, `${LEGACY_PREFIX}*`, count);
  const vals = keys.length ? await kvMGet(keys) : {};
  const toSet = [];
  let bad = 0;
  let rejected = 0;
  keys.forEach((k) => {
    const key = k.slice(LEGACY_PREFIX.length);
    const id = identityKeyOf(key);
    const v = vals[k];
    if (!id || !isValidCoord(v)) { bad += 1; return; }
    // 옛 예열은 검색 결과를 지역 확인 없이 저장했다. 다른 시·도 좌표는 새 형식으로 옮기지 않는다(옛 키는 그대로 둔다).
    if (!plausibleForKey(key, v)) { rejected += 1; return; }
    toSet.push([IDENT_PREFIX + id, { lat: v.lat, lng: v.lng }]);
  });
  const created = toSet.length ? await kvMSetNX(toSet) : 0;
  // 끝까지 훑었으면(다음 커서가 '0') 완료 표시를 남긴다 — 점검 페이지가 "변환 완료"를 보여주는 데 쓴다.
  if (next === '0') await kvMSet([[MIGRATION_MARKER, { at: new Date().toISOString() }]]);
  return { cursor: next, scanned: keys.length, created, existing: toSet.length - created, bad, rejected };
}
import { kvMGet, kvMSet, kvMSetNX, kvScan } from './kv';
import { complexIdentity } from './complex-name';

// 단지 좌표를 서버(KV)에 저장·조회하는 유일한 통로. 조회·저장·예열이 전부 여기를 거친다.
//
// 왜 필요한가: 예열은 K-apt 단지명, 지도는 실거래 단지명으로 키를 만들어서 표기가 조금만 달라도
// ("목동신시가지 1단지" / "목동신시가지1단지") 예열해둔 좌표가 쓰이지 않았다. 그래서 키를
// "지역|동|정규화한 이름"(identity)으로 통일해서 저장하고, 조회할 때는 identity 키와 옛 키(legacy)를 둘 다 본다.
//   geoi:<지역>|<동>|<정규화 이름>   ← 새 형식. 앞으로의 저장은 전부 여기에.
//   geo:<지역>|<동>|<이름>           ← 옛 형식. 읽기만 하고(마이그레이션 대상), 새로 쓰지 않는다.
export const LEGACY_PREFIX = 'geo:';
export const IDENT_PREFIX = 'geoi:';

const KOREA = { latMin: 32.5, latMax: 39.0, lngMin: 124.0, lngMax: 132.5 };
export const isValidCoord = (c) => !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng)
  && c.lat >= KOREA.latMin && c.lat <= KOREA.latMax && c.lng >= KOREA.lngMin && c.lng <= KOREA.lngMax;

// "지역코드|동|단지명" → 세 조각. 단지명 안에 '|'가 있어도 앞 두 개만 구분자로 본다.
export function splitComplexKey(key) {
  const s = String(key || '');
  const i = s.indexOf('|');
  const j = i < 0 ? -1 : s.indexOf('|', i + 1);
  if (i < 0 || j < 0) return null;
  return { regionCode: s.slice(0, i), dong: s.slice(i + 1, j), apt: s.slice(j + 1) };
}

export function identityKeyOf(key) {
  const p = splitComplexKey(key);
  if (!p || !p.apt) return null;
  return complexIdentity(p.regionCode, p.dong, p.apt);
}

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

// keys: 지도/예열이 쓰는 단지 키 목록. 반환: { data: { [요청한 키]: {lat,lng} }, stats }.
//  - identity 키가 있으면 그걸 우선한다(검증된 최신값이고, 표기가 달라도 맞는다).
//  - 없으면 옛 키로 찾고, 찾았으면 identity 키로 복사해 둔다(다음부터는 표기가 달라도 맞게 — 값이 이미 있으면 덮어쓰지 않는다).
export async function readCoords(keys, { migrate = true } = {}) {
  const wanted = (keys || []).filter(Boolean);
  const kvKeys = new Set();
  const plan = wanted.map((key) => {
    const id = identityKeyOf(key);
    const idKv = id ? IDENT_PREFIX + id : null;
    const lgKv = LEGACY_PREFIX + key;
    if (idKv) kvKeys.add(idKv);
    kvKeys.add(lgKv);
    return { key, idKv, lgKv };
  });
  const hits = {};
  // 한 번에 보내는 명령 수를 제한한다(identity+옛 키라 요청당 최대 2배가 된다).
  // eslint-disable-next-line no-restricted-syntax
  for (const part of chunk([...kvKeys], 1000)) {
    // eslint-disable-next-line no-await-in-loop
    Object.assign(hits, await kvMGet(part));
  }
  const data = {};
  const toCopy = new Map();
  let viaIdentity = 0;
  let viaLegacy = 0;
  plan.forEach(({ key, idKv, lgKv }) => {
    const idVal = idKv ? hits[idKv] : null;
    if (isValidCoord(idVal)) { data[key] = { lat: idVal.lat, lng: idVal.lng }; viaIdentity += 1; return; }
    const lgVal = hits[lgKv];
    if (isValidCoord(lgVal)) {
      data[key] = { lat: lgVal.lat, lng: lgVal.lng };
      viaLegacy += 1;
      if (idKv) toCopy.set(idKv, { lat: lgVal.lat, lng: lgVal.lng });
    }
  });
  let copied = 0;
  if (migrate && toCopy.size > 0) {
    try { copied = await kvMSetNX([...toCopy]); } catch (e) { /* 복사는 부가 기능 — 실패해도 조회 결과는 그대로 돌려준다 */ }
  }
  return { data, stats: { asked: wanted.length, hit: Object.keys(data).length, viaIdentity, viaLegacy, copied } };
}

// entries: [{ key, lat, lng }]. identity 키로 저장한다(같은 단지의 값은 덮어써서, 잘못 저장돼 있던 값이 고쳐진다).
export async function writeCoords(entries) {
  const byKv = new Map();
  (entries || []).forEach((e) => {
    if (!e?.key || !isValidCoord(e)) return;
    const id = identityKeyOf(e.key);
    byKv.set(id ? IDENT_PREFIX + id : LEGACY_PREFIX + e.key, { lat: e.lat, lng: e.lng });
  });
  const list = [...byKv];
  // eslint-disable-next-line no-restricted-syntax
  for (const part of chunk(list, 500)) {
    // eslint-disable-next-line no-await-in-loop
    await kvMSet(part);
  }
  return list.length;
}

// 옛 키(geo:)를 한 페이지 훑어서 identity 키(geoi:)로 복사한다. 이미 identity 값이 있으면 건드리지 않는다.
// 반환한 cursor가 '0'이면 끝. 관리자 페이지가 '0'이 될 때까지 반복해서 부른다.
export async function migrateLegacyPage(cursor = '0', count = 500) {
  const [next, keys] = await kvScan(cursor, `${LEGACY_PREFIX}*`, count);
  const vals = keys.length ? await kvMGet(keys) : {};
  const toSet = [];
  let bad = 0;
  keys.forEach((k) => {
    const id = identityKeyOf(k.slice(LEGACY_PREFIX.length));
    const v = vals[k];
    if (!id || !isValidCoord(v)) { bad += 1; return; }
    toSet.push([IDENT_PREFIX + id, { lat: v.lat, lng: v.lng }]);
  });
  const created = toSet.length ? await kvMSetNX(toSet) : 0;
  return { cursor: next, scanned: keys.length, created, existing: toSet.length - created, bad };
}

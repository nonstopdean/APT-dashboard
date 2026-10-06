const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export function kvReady() {
  return Boolean(KV_URL && KV_TOKEN);
}

export async function kvGet(key) {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const json = await res.json();
  if (json.result == null) return null;
  try {
    return JSON.parse(json.result);
  } catch (e) {
    return json.result;
  }
}

export async function kvSet(key, value) {
  const body = encodeURIComponent(JSON.stringify(value));
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${body}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
}

// 여러 키를 한 번의 요청(pipeline)으로 조회한다 — 키 개수만큼 개별 요청을 보내면
// 그 자체가 병목이 되므로, 반드시 이 함수로 한 번에 가져온다.
export async function kvMGet(keys) {
  if (!keys || keys.length === 0) return {};
  const commands = keys.map((k) => ['GET', k]);
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  const results = await res.json();
  const out = {};
  keys.forEach((k, i) => {
    const val = results?.[i]?.result;
    if (val == null) return;
    try {
      out[k] = JSON.parse(val);
    } catch (e) {
      out[k] = val;
    }
  });
  return out;
}

// 여러 키를 한 번의 요청(pipeline)으로 저장한다.
export async function kvMSet(entries) {
  if (!entries || entries.length === 0) return;
  const commands = entries.map(([k, v]) => ['SET', k, JSON.stringify(v)]);
  await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
}

// 값이 없을 때만 저장한다(SET ... NX). 이미 있는 값은 덮어쓰지 않는다 — 옛 키를 새 키로 옮길 때
// 더 최신(검증된) 값이 이미 있으면 그걸 지키기 위해 쓴다. 새로 저장된 개수를 돌려준다.
export async function kvMSetNX(entries) {
  if (!entries || entries.length === 0) return 0;
  const commands = entries.map(([k, v]) => ['SET', k, JSON.stringify(v), 'NX']);
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  const results = await res.json();
  return (results || []).filter((r) => r?.result === 'OK').length;
}

// 키를 조금씩 훑는다(SCAN). [다음 커서, 키 목록]을 돌려주고, 다음 커서가 '0'이면 끝이다.
export async function kvScan(cursor, match, count = 500) {
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['SCAN', String(cursor), 'MATCH', match, 'COUNT', String(count)]]),
  });
  const results = await res.json();
  const out = results?.[0]?.result;
  if (!Array.isArray(out)) throw new Error('SCAN 응답 형식이 예상과 다릅니다.');
  return [String(out[0]), out[1] || []];
}

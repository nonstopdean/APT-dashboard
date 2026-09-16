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

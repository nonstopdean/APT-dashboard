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

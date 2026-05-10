const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function headers(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function buildFilterParams(filters) {
  if (!filters) return "";
  return Object.entries(filters)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

async function query(table, { select = "*", filters, order, limit } = {}) {
  const params = new URLSearchParams();
  params.set("select", select);

  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      params.set(key, value);
    }
  }
  if (order) params.set("order", order);
  if (limit) params.set("limit", String(limit));

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    method: "GET",
    headers: headers(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase query ${table} failed (${res.status}): ${body}`);
  }

  return res.json();
}

async function insert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase insert ${table} failed (${res.status}): ${body}`);
  }

  return res.json();
}

async function update(table, filters, data) {
  const filterStr = buildFilterParams(filters);
  const url = `${SUPABASE_URL}/rest/v1/${table}${filterStr ? `?${filterStr}` : ""}`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase update ${table} failed (${res.status}): ${body}`);
  }

  return res.json();
}

async function rpc(functionName, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase rpc ${functionName} failed (${res.status}): ${body}`);
  }

  return res.json();
}

async function uploadFile(bucket, path, buffer, contentType) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: buffer,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase upload ${bucket}/${path} failed (${res.status}): ${body}`);
  }

  return res.json();
}

module.exports = { query, insert, update, rpc, uploadFile };

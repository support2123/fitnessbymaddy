export function maskPhone(phone) {
  if (!phone) return '';
  const s = String(phone).replace(/[^0-9+]/g, '');
  if (s.length < 6) return s.replace(/./g, 'X');
  return `${s.slice(0, 3)}XXX...${s.slice(-3)}`;
}

export function normalisePhone(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/[^\d+]/g, '');
  if (!s) return null;
  return s.startsWith('+') ? s : `+${s}`;
}

export function ok(body = { ok: true }, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

export function bad(message, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !(req.body instanceof Buffer)) {
    return req.body;
  }
  try {
    if (typeof req.json === 'function') return await req.json();
  } catch {}
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

export function requireCronAuth(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // dev mode
  const got =
    req.headers['x-cron-secret'] ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return got === expected;
}

export function nowIso() { return new Date().toISOString(); }

export function addHoursIso(hours) {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

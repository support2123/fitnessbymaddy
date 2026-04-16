// Tiny helpers for Vercel Node serverless handlers.

export function json(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(data));
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.length) {
    try { return JSON.parse(req.body); } catch { return { raw: req.body }; }
  }
  // Fallback: read stream
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { raw }; }
}

export function requireMethod(req, res, ...methods) {
  if (!methods.includes(req.method)) {
    json(res, 405, { error: `Method ${req.method} not allowed` });
    return false;
  }
  return true;
}

export function requireAuth(req, res, envKey) {
  const token = req.headers['x-admin-token'] || req.query?.token;
  if (!process.env[envKey]) {
    json(res, 500, { error: `${envKey} not configured` });
    return false;
  }
  if (token !== process.env[envKey]) {
    json(res, 401, { error: 'unauthorized' });
    return false;
  }
  return true;
}

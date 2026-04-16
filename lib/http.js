// Minimal HTTP helpers for serverless handlers.

export function json(res, status, obj) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(obj));
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => { buf += c; });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); }
      catch {
        // Fallback: form-urlencoded
        const out = {};
        buf.split('&').forEach(kv => {
          const [k, v] = kv.split('=');
          if (k) out[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '));
        });
        resolve(out);
      }
    });
    req.on('error', () => resolve({}));
  });
}

export function requireAdmin(req) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return false;
  const header = req.headers['authorization'] || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const query = (req.query && req.query.token) || '';
  return bearer === token || query === token;
}

export function isCronRequest(req) {
  // Vercel Cron sets this header.
  return !!req.headers['x-vercel-cron'];
}

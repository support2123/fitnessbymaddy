// Tiny request helpers for Vercel Node serverless functions.

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { _raw: raw }; }
}

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function methodNotAllowed(res, allow) {
  res.statusCode = 405;
  res.setHeader('Allow', allow);
  res.end();
}

// Allow CORS only for our own origin (for form posts from fitnessbymaddy.com)
export function cors(req, res) {
  const origin = req.headers.origin || '';
  if (/^https?:\/\/([a-z0-9-]+\.)*fitnessbymaddy\.com$/i.test(origin) || origin === 'http://localhost:3000') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  return false;
}

export function gateCron(req, res) {
  const got = req.headers['authorization'] || '';
  const expect = `Bearer ${process.env.CRON_SECRET || ''}`;
  if (!process.env.CRON_SECRET || got !== expect) {
    // Vercel Cron also sets a user-agent; accept it when CRON_SECRET is unset in preview.
    if (!(req.headers['user-agent'] || '').includes('vercel-cron')) {
      res.statusCode = 401; res.end('unauthorized'); return true;
    }
  }
  return false;
}

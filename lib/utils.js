// Shared helpers. Keep framework-free — these run inside Vercel serverless functions.

export function maskPhone(phone) {
  if (!phone) return '';
  const s = String(phone).replace(/[^\d+]/g, '');
  if (s.length < 7) return s;
  return `${s.slice(0, 4)}XXX...${s.slice(-3)}`;
}

export function normalisePhone(phone) {
  if (!phone) return null;
  let s = String(phone).trim().replace(/[^\d+]/g, '');
  if (!s.startsWith('+')) {
    // Assume IN if 10 digits, else prefix +.
    s = s.length === 10 ? `+91${s}` : `+${s}`;
  }
  return s;
}

export function detectMarket(phone) {
  const p = normalisePhone(phone) || '';
  if (p.startsWith('+91')) return 'IN';
  if (p.startsWith('+971')) return 'UAE';
  if (p.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}

export function isHinglish(market) {
  return market === 'IN';
}

// Basic escalation keyword scan.
const ESCALATION_PATTERNS = [
  /\binjur(y|ies|ed)\b/i,
  /\bpregnan(cy|t)\b/i,
  /\bmedication\b/i,
  /\bmedical\b/i,
  /\bsurgery\b/i,
  /\bpain\b/i,
  /\bdizz/i,
  /\bchest\s*pain\b/i,
  /\brefund\b/i,
  /\blawyer\b/i,
  /\bcomplaint\b/i,
  /\bdidn.?t work\b/i,
  /\bside effect/i,
  /\bdisorder(ed)? eating\b/i,
  /\banorex/i,
  /\bbulimi/i
];

export function escalationReason(text) {
  if (!text) return null;
  for (const re of ESCALATION_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

export function isOptOut(text) {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  return t === 'stop' || t === 'unsubscribe' || t === 'stop all';
}

export function maskForLog(obj) {
  // Shallow clone that redacts phone fields.
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [...obj] : { ...obj };
  for (const k of Object.keys(out)) {
    if (/phone|whatsapp|wa_id|msisdn/i.test(k)) out[k] = maskPhone(out[k]);
  }
  return out;
}

export function jsonResponse(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined) return resolve(req.body);
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch { resolve(data); }
    });
    req.on('error', reject);
  });
}

export function weekNumberSince(startIso) {
  if (!startIso) return 1;
  const start = new Date(startIso).getTime();
  const ms = Date.now() - start;
  return Math.max(1, Math.floor(ms / (7 * 24 * 60 * 60 * 1000)) + 1);
}

export function requireCron(req) {
  // Vercel sets this header for scheduled invocations.
  const secret = req.headers['x-vercel-cron'] || req.headers['authorization'];
  if (!secret) throw new Error('Cron secret missing');
  return true;
}

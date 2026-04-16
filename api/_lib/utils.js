// Small, dependency-free helpers shared across endpoints.
// Kept pure so every function stays easy to unit-test.

// ─── Phone normalization ─────────────────────────────────────
// AiSensy sends numbers in a handful of shapes ("919812345678",
// "+919812345678", "whatsapp:+91..."). Normalize to E.164.
export function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).trim().replace(/^whatsapp:/i, '').replace(/[\s\-()]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (!p.startsWith('+')) p = '+' + p;
  // E.164: 1 leading +, 8–15 digits after it.
  return /^\+\d{8,15}$/.test(p) ? p : null;
}

// Mask phone numbers everywhere except the audit log. +91XXX...374
export function maskPhone(p) {
  if (!p) return '';
  const s = String(p);
  if (s.length < 7) return s.replace(/\d/g, 'X');
  return s.slice(0, 3) + 'XXX...' + s.slice(-3);
}

// Market detection by country code → drives language + tone.
// IN: Hinglish. UAE/UK/GLOBAL: English.
export function detectMarket(phoneE164) {
  if (!phoneE164) return 'GLOBAL';
  if (phoneE164.startsWith('+91'))  return 'IN';
  if (phoneE164.startsWith('+971')) return 'UAE';
  if (phoneE164.startsWith('+44'))  return 'UK';
  return 'GLOBAL';
}

// ─── Keyword → program routing ───────────────────────────────
// Order matters: the more specific signals come first so "pcos"
// wins over an incidental "weight" in the same message.
const ROUTING = [
  { rx: /\b(12[-\s]?week|twelve\s?week|custom|serious|transformation|flagship)\b/i,
    program: '12wk' },
  { rx: /\b(pcos|hormonal|hormone|pcod)\b/i,
    program: 'pcos' },
  { rx: /\b(40\+?|forty|menopause|peri[-\s]?menopause|joints?)\b/i,
    program: '40plus' },
  { rx: /\b(home\s?workout|no\s?gym|at\s?home|body\s?weight)\b/i,
    program: '6wk_home' },
  { rx: /\b(fat\s?loss|weight\s?loss|shred|lean|cut|burn)\b/i,
    program: '6wk_gym' },
  { rx: /\b(zoom\s?pack|pack)\b/i, program: 'zoom_pack' },
  { rx: /\b(trial|zoom|not\s?sure|explore|try)\b/i, program: 'zoom_trial' },
];

export function classifyProgram(text) {
  if (!text) return null;
  for (const r of ROUTING) if (r.rx.test(text)) return r.program;
  return null;
}

// ─── Escalation triggers ─────────────────────────────────────
// If any of these hit, pipeline halts and pings Maddy.
const ESCALATION_PATTERNS = [
  /\binjur(?:y|ed|ies)\b/i,
  /\b(pregnan(?:t|cy)|ttc|trying to conceive)\b/i,
  /\bmedication|medicine|on\s+meds?\b/i,
  /\b(diabetes|thyroid|bp|blood\s?pressure|hypertension|heart|cardiac)\b/i,
  /\b(pain|dizz(?:y|iness)|faint|nausea|vomit)\b/i,
  /\b(refund|lawyer|legal|complaint)\b/i,
  /\b(didn[' ]?t work|doesn[' ]?t work|scam|fraud)\b/i,
  /\b(side[-\s]?effect|allerg(?:y|ic))\b/i,
  /\b(starv|anorex|bulim|purg|ed\b)/i,   // disordered-eating signals
];

export function detectEscalation(text) {
  if (!text) return null;
  for (const rx of ESCALATION_PATTERNS) {
    const m = text.match(rx);
    if (m) return m[0];
  }
  return null;
}

export function isOptOut(text) {
  return /^(stop|unsubscribe|cancel|remove me|opt[-\s]?out)\b/i.test(
    (text || '').trim(),
  );
}

// ─── Rate limiter helper ─────────────────────────────────────
// 1 outbound / lead / 2 hrs except for opted-in clients.
export function canSendOutbound(lastOutboundAt, isClient = false) {
  if (isClient) return true;
  if (!lastOutboundAt) return true;
  const last = new Date(lastOutboundAt).getTime();
  return Date.now() - last > 2 * 60 * 60 * 1000;
}

// ─── JSON response helper ────────────────────────────────────
export function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).send(JSON.stringify(body));
}

// ─── Random token for checkin form links ─────────────────────
export function randomToken(n = 24) {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

// ─── Cron auth ───────────────────────────────────────────────
// Vercel sets `authorization: Bearer ${CRON_SECRET}` on scheduled
// invocations. Reject anything else to block public POSTs.
export function assertCron(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // local dev, allow
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return got === expected;
}

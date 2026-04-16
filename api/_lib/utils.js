function maskPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 6) return '+X…';
  return `+${digits.slice(0, 2)}XXX…${digits.slice(-3)}`;
}

// Normalise to E.164-ish (+<countrycode><number>)
function normalisePhone(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+')) {
    // Default to India if 10 digits and no code
    if (/^\d{10}$/.test(s)) s = '+91' + s;
    else if (/^\d{11,15}$/.test(s)) s = '+' + s;
    else return null;
  }
  return s;
}

function marketFromPhone(phone) {
  const p = normalisePhone(phone) || '';
  if (p.startsWith('+91')) return 'IN';
  if (p.startsWith('+971')) return 'UAE';
  if (p.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}

function isIndian(phone) {
  return marketFromPhone(phone) === 'IN';
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function err(res, status, message, extra = {}) {
  return json(res, status, { ok: false, error: message, ...extra });
}

function ok(res, body = {}) {
  return json(res, 200, { ok: true, ...body });
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
  });
}

function assertMethod(req, res, methods) {
  if (!methods.includes(req.method)) {
    res.setHeader('Allow', methods.join(', '));
    err(res, 405, 'method_not_allowed');
    return false;
  }
  return true;
}

function cryptoRandomToken(len = 24) {
  const bytes = require('crypto').randomBytes(len);
  return bytes.toString('base64url');
}

function iso(date = new Date()) { return date.toISOString(); }

function hoursAgo(h) { return new Date(Date.now() - h * 3600 * 1000); }
function daysAgo(d) { return new Date(Date.now() - d * 86400 * 1000); }

module.exports = {
  maskPhone, normalisePhone, marketFromPhone, isIndian,
  json, ok, err, readJson, assertMethod,
  cryptoRandomToken, iso, hoursAgo, daysAgo,
};

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  if (/\b(stop|unsubscribe|opt.?out|remove)\b/.test(lower)) return 'OPT_OUT';

  const escalationPatterns = [
    /\b(refund|lawyer|complaint|didn'?t work|side effect)/,
    /\b(injur|medical|pregnan|medication|pain|dizz|disordered)/
  ];
  for (const p of escalationPatterns) {
    if (p.test(lower)) return 'ESCALATION';
  }

  if (/\b(fat.?loss|weight|shred|burn|lean|slim)\b/.test(lower)) return '6wk';
  if (/\b(pcos|hormonal|hormone|period|irregular)\b/.test(lower)) return 'pcos';
  if (/\b(40|forty|menopause|joints|senior|mature)\b/.test(lower)) return '40plus';
  if (/\b(custom|12.?week|serious|flagship|transform)\b/.test(lower)) return '12wk';
  if (/\b(trial|zoom|not sure|try|test|sample)\b/.test(lower)) return 'zoom_trial';

  return null;
}

function programLabel(code) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '6wk': '6-Week Burn & Build',
    '12wk': '12-Week Custom Training',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack'
  };
  return labels[code] || code;
}

function programPrice(code) {
  const prices = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '6wk': 97,
    '12wk': 200,
    'pcos': 45,
    '40plus': 50,
    'zoom_trial': 20,
    'zoom_pack': 80
  };
  return prices[code] || 0;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

function jsonResponse(res, data, status = 200) {
  const headers = corsHeaders();
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  res.status(status).json(data);
}

function errorResponse(res, message, status = 400) {
  jsonResponse(res, { error: message }, status);
}

function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body) return resolve(req.body);
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
  });
}

function weeksBetween(start, now) {
  const ms = now.getTime() - new Date(start).getTime();
  return Math.floor(ms / (7 * 24 * 60 * 60 * 1000)) + 1;
}

module.exports = {
  maskPhone,
  detectMarket,
  classifyIntent,
  programLabel,
  programPrice,
  corsHeaders,
  jsonResponse,
  errorResponse,
  parseBody,
  weeksBetween
};

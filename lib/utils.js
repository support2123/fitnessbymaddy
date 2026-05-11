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
  const lower = text.toLowerCase();

  if (/\b(stop|unsubscribe|opt.?out|hatao|band karo)\b/.test(lower)) {
    return 'STOP';
  }

  const escalationPatterns = /\b(injury|medical|pregnant|pregnancy|medication|medicine|pain|dizziness|dizzy|eating disorder|anorexia|bulimia|refund|lawyer|complaint|didn'?t work|side effect|doctor)\b/;
  if (escalationPatterns.test(lower)) {
    return 'ESCALATION';
  }

  if (/\b(fat loss|weight loss|weight|shred|patla|slim|belly)\b/.test(lower)) return '6wk';
  if (/\b(pcos|hormonal|hormone|pcod|thyroid)\b/.test(lower)) return 'pcos';
  if (/\b(40|forty|menopause|joints|joint|senior|older)\b/.test(lower)) return '40plus';
  if (/\b(custom|12 week|12.week|serious|advanced|flagship)\b/.test(lower)) return '12wk';
  if (/\b(trial|zoom|try|not sure|confused|pata nahi|samajh)\b/.test(lower)) return 'zoom_trial';

  return null;
}

function programLabel(code) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '6wk': '6-Week Burn & Build',
    '12wk': '12-Week Custom Training',
    pcos: 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    zoom_trial: 'Zoom Trial Session',
    zoom_pack: 'Zoom Sessions Pack',
  };
  return labels[code] || code;
}

function programPrice(code) {
  const prices = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '6wk': 97,
    '12wk': 200,
    pcos: 45,
    '40plus': 50,
    zoom_trial: 20,
    zoom_pack: 150,
  };
  return prices[code] || 0;
}

function json(res, data, status = 200) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json(data);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) return resolve(req.body);
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

module.exports = {
  detectMarket,
  classifyIntent,
  programLabel,
  programPrice,
  json,
  parseBody,
};

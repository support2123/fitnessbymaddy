function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function classifyIntent(message) {
  if (!message) return null;
  const msg = message.toLowerCase();

  if (/fat\s*loss|weight|shred|lean|slim|cut/.test(msg)) return '6wk_gym';
  if (/pcos|hormonal|hormone|period|irregular/.test(msg)) return 'pcos';
  if (/40\+?|forty|menopause|joints?|senior|age/.test(msg)) return '40plus';
  if (/custom|12\s*week|serious|flagship|transform/.test(msg)) return '12wk';
  if (/trial|zoom|not\s*sure|try|test/.test(msg)) return 'zoom_trial';
  if (/home|no\s*gym|bodyweight|at\s*home/.test(msg)) return '6wk_home';
  return null;
}

function programLabel(code) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Program',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Pack',
  };
  return labels[code] || code;
}

function programPrice(code) {
  const prices = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '12wk': 200,
    'pcos': 45,
    '40plus': 50,
    'zoom_trial': 20,
    'zoom_pack': 120,
  };
  return prices[code] || 0;
}

function isOptOut(message) {
  if (!message) return false;
  const msg = message.toLowerCase().trim();
  return /^(stop|unsubscribe|cancel|opt.?out|remove me)$/i.test(msg);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body) return resolve(req.body);
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
  });
}

function weekNumber(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diff = now - start;
  return Math.max(1, Math.ceil(diff / (7 * 24 * 60 * 60 * 1000)));
}

module.exports = {
  detectMarket,
  classifyIntent,
  programLabel,
  programPrice,
  isOptOut,
  cors,
  parseBody,
  weekNumber,
};

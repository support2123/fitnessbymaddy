function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglishMarket(market) {
  return market === 'IN';
}

function classifyIntent(message) {
  const lower = (message || '').toLowerCase();

  if (/fat\s*loss|weight|shred|lean|cut/i.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|period|irregular/i.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joint|knee/i.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|personali/i.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try|test/i.test(lower)) return 'zoom_trial';
  if (/home|no\s*gym|bodyweight|at\s*home/i.test(lower)) return '6wk_home';
  return null;
}

function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}

function programLabel(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    pcos: 'PCOS Warrior',
    '40plus': '40+ Strong',
    zoom_trial: 'Zoom Trial Session',
    zoom_pack: 'Zoom Session Pack',
  };
  return map[code] || code;
}

function programPrice(code) {
  const map = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '12wk': 200,
    pcos: 45,
    '40plus': 50,
    zoom_trial: 20,
    zoom_pack: 80,
  };
  return map[code] || 0;
}

function weeksBetween(startDate, endDate) {
  const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
  return Math.floor(ms / (7 * 24 * 60 * 60 * 1000));
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body) return resolve(req.body);
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglishMarket,
  classifyIntent,
  isOptOut,
  programLabel,
  programPrice,
  weeksBetween,
  cors,
  parseBody,
};

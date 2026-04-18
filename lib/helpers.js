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

function isHinglish(market) {
  return market === 'IN';
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/stop|unsubscribe|opt.?out/i.test(lower)) return 'OPTOUT';

  const escalation = [
    'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
    'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
    'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  ];
  if (escalation.some((w) => lower.includes(w))) return 'ESCALATE';

  if (/fat.?loss|weight|shred|lean|cut/i.test(lower)) return '6wk';
  if (/pcos|hormonal|period|irregular/i.test(lower)) return 'pcos';
  if (/40|menopause|joint|knee|back pain|senior/i.test(lower)) return '40plus';
  if (/custom|12.?week|serious|premium|flagship/i.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try|test/i.test(lower)) return 'zoom_trial';

  return null;
}

function programCheckoutUrl(program) {
  const urls = {
    '6wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
    'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
    '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
    '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
    'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  };
  return urls[program] || urls['zoom_trial'];
}

function programName(code) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '6wk': '6-Week Burn & Build',
    '12wk': '12-Week Custom Program',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Coaching Pack',
  };
  return names[code] || code;
}

function weeksBetween(start, end) {
  const ms = new Date(end) - new Date(start);
  return Math.floor(ms / (7 * 24 * 60 * 60 * 1000)) + 1;
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
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
  });
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglish,
  classifyIntent,
  programCheckoutUrl,
  programName,
  weeksBetween,
  cors,
  parseBody,
};

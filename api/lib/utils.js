function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  if (/\b(stop|unsubscribe|opt.?out|hatao|band karo)\b/.test(lower)) return 'OPT_OUT';

  const escalationPatterns = [
    /\b(injury|injur|chot|dard)\b/,
    /\b(medical|doctor|dawai|medicine|medication)\b/,
    /\b(pregnan|garbh)\b/,
    /\b(pain|dizz|chakkar|suicid|eating disorder|khana nahi)\b/,
    /\b(refund|paisa wapas|money back)\b/,
    /\b(lawyer|legal|complaint|consumer forum)\b/,
    /\b(didn.?t work|not working|side effect|problem)\b/
  ];
  for (const p of escalationPatterns) {
    if (p.test(lower)) return 'ESCALATE';
  }

  if (/\b(fat.?loss|weight|shred|patla|vajan|lose)\b/.test(lower)) return 'FAT_LOSS';
  if (/\b(pcos|hormonal|pcod|period)\b/.test(lower)) return 'PCOS';
  if (/\b(40|forty|menopause|joint|ghutna|kamar)\b/.test(lower)) return '40PLUS';
  if (/\b(custom|12.?week|serious|flagship|personal)\b/.test(lower)) return 'CUSTOM_12WK';
  if (/\b(trial|zoom|not sure|try|dekhna|pehle)\b/.test(lower)) return 'TRIAL';

  return null;
}

function programForIntent(intent) {
  const map = {
    'FAT_LOSS': { program: '6wk_gym', name: '6-Week Burn & Build', price: 97 },
    'PCOS': { program: 'pcos', name: 'PCOS Warrior Program', price: 45 },
    '40PLUS': { program: '40plus', name: '40+ Strong Program', price: 50 },
    'CUSTOM_12WK': { program: '12wk', name: '12-Week Custom Program', price: 200 },
    'TRIAL': { program: 'zoom_trial', name: 'Zoom Trial Session', price: 20 }
  };
  return map[intent] || null;
}

function isHinglish(market) {
  return market === 'IN';
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) return resolve(req.body);
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(data);
      }
    });
    req.on('error', reject);
  });
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function weeksBetween(startDate, now) {
  const diff = now.getTime() - new Date(startDate).getTime();
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
}

module.exports = {
  detectMarket,
  maskPhone,
  classifyIntent,
  programForIntent,
  isHinglish,
  parseBody,
  corsHeaders,
  weeksBetween
};

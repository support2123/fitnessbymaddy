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

function classifyIntent(message) {
  const lower = (message || '').toLowerCase();

  if (/stop|unsubscribe|opt.?out/i.test(lower)) return 'OPT_OUT';

  if (/refund|lawyer|complaint|didn'?t work|side effect/i.test(lower)) return 'ESCALATE';

  if (/injur|medical|pregnan|medication|pain|dizz|eating disorder/i.test(lower)) return 'ESCALATE_MEDICAL';

  if (/fat.?loss|weight|shred|slim|lean/i.test(lower)) return 'FAT_LOSS';
  if (/pcos|hormonal|pcod/i.test(lower)) return 'PCOS';
  if (/40|menopause|joint|senior|older/i.test(lower)) return '40PLUS';
  if (/custom|12.?week|serious|transform|flagship/i.test(lower)) return '12WEEK';
  if (/trial|zoom|not sure|try|test/i.test(lower)) return 'TRIAL';

  return 'UNKNOWN';
}

function getProgramForIntent(intent) {
  const map = {
    FAT_LOSS: { program: '6wk_gym', name: '6-Week Burn & Build', price: 35 },
    PCOS: { program: 'pcos', name: 'PCOS Warrior', price: 45 },
    '40PLUS': { program: '40plus', name: '40+ Strong', price: 50 },
    '12WEEK': { program: '12wk', name: '12-Week Flagship', price: 200 },
    TRIAL: { program: 'zoom_trial', name: 'Zoom Trial Session', price: 20 },
  };
  return map[intent] || null;
}

function getLanguage(market) {
  return market === 'IN' ? 'hinglish' : 'english';
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
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
  });
}

module.exports = {
  detectMarket,
  maskPhone,
  classifyIntent,
  getProgramForIntent,
  getLanguage,
  cors,
  parseBody,
};

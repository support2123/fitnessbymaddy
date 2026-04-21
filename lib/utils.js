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

function classifyIntent(message) {
  if (!message) return null;
  const lower = message.toLowerCase().trim();

  if (/\b(stop|unsubscribe|opt.?out|leave me alone)\b/.test(lower)) {
    return 'OPT_OUT';
  }

  const escalationPatterns = [
    /\b(refund|lawyer|complaint|didn'?t work|side effect)\b/,
    /\b(injury|injur|medical|pregnant|pregnancy|medication|medicine)\b/,
    /\b(pain|dizziness|dizzy|eating disorder|anorex|bulimi|purge)\b/,
  ];
  for (const p of escalationPatterns) {
    if (p.test(lower)) return 'ESCALATE';
  }

  if (/\b(fat.?loss|weight|shred|lose|slim|lean|burn)\b/.test(lower)) return 'FAT_LOSS';
  if (/\b(pcos|hormonal|hormone|pcod)\b/.test(lower)) return 'PCOS';
  if (/\b(40|forty|menopause|joint|knee|back pain|50|fifty)\b/.test(lower)) return '40PLUS';
  if (/\b(custom|12.?week|serious|transform|flagship)\b/.test(lower)) return '12WK';
  if (/\b(trial|zoom|not sure|try|test|sample)\b/.test(lower)) return 'TRIAL';

  return null;
}

function programForIntent(intent) {
  const map = {
    FAT_LOSS: { program: '6wk_gym', name: '6-Week Burn & Build', price: 97 },
    PCOS: { program: 'pcos', name: 'PCOS Warrior', price: 45 },
    '40PLUS': { program: '40plus', name: '40+ Strong', price: 50 },
    '12WK': { program: '12wk', name: '12-Week Custom Flagship', price: 200 },
    TRIAL: { program: 'zoom_trial', name: 'Zoom Trial Session', price: 20 },
  };
  return map[intent] || null;
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

function sendJson(res, status, data) {
  corsHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglish,
  classifyIntent,
  programForIntent,
  parseBody,
  corsHeaders,
  sendJson,
};

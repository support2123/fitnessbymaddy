function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function classifyIntent(text) {
  const lower = (text || '').toLowerCase();

  const escalationKeywords = [
    'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
    'pain', 'dizziness', 'dizzy', 'eating disorder', 'purge', 'binge',
    'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  ];
  for (const kw of escalationKeywords) {
    if (lower.includes(kw)) return { program: null, escalate: true, keyword: kw };
  }

  if (/stop|unsubscribe/i.test(lower)) return { program: null, optout: true };

  if (/fat\s*loss|weight|shred/i.test(lower)) return { program: '6wk_gym' };
  if (/pcos|hormonal/i.test(lower)) return { program: 'pcos' };
  if (/\b40\b|menopause|joints/i.test(lower)) return { program: '40plus' };
  if (/custom|12\s*week|serious/i.test(lower)) return { program: '12wk' };
  if (/trial|zoom|not sure/i.test(lower)) return { program: 'zoom_trial' };
  if (/home/i.test(lower)) return { program: '6wk_home' };

  return { program: null };
}

const PROGRAM_INFO = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97, weeks: 6 },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97, weeks: 6 },
  'pcos': { name: 'PCOS Warrior Program', price: 45, weeks: 6 },
  '40plus': { name: '40+ Strong Program', price: 50, weeks: 6 },
  '12wk': { name: '12-Week Custom Flagship', price: 200, weeks: 12 },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, weeks: 1 },
  'zoom_pack': { name: 'Zoom Session Pack', price: 150, weeks: 4 },
};

function getProgramInfo(programKey) {
  return PROGRAM_INFO[programKey] || null;
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

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

module.exports = {
  maskPhone,
  detectMarket,
  classifyIntent,
  getProgramInfo,
  PROGRAM_INFO,
  parseBody,
  cors,
};

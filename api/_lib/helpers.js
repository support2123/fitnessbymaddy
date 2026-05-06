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

function detectProgram(message) {
  if (!message) return null;
  const msg = message.toLowerCase();
  if (/fat\s*loss|weight|shred|slim|lean/.test(msg)) return '6wk_gym';
  if (/pcos|hormonal|hormone/.test(msg)) return 'pcos';
  if (/40|menopause|joints|senior|joint/.test(msg)) return '40plus';
  if (/custom|12\s*week|serious|premium|flagship/.test(msg)) return '12wk';
  if (/trial|zoom|not\s*sure|try|test/.test(msg)) return 'zoom_trial';
  if (/home|no\s*gym|bodyweight/.test(msg)) return '6wk_home';
  return null;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Training',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Session Pack',
};

const PROGRAM_PRICES = {
  '6wk_gym': 9700,
  '6wk_home': 9700,
  '12wk': 20000,
  'pcos': 4500,
  '40plus': 5000,
  'zoom_trial': 2000,
  'zoom_pack': 15000,
};

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'faint', 'chest pain', 'heart',
];

function needsEscalation(message) {
  if (!message) return null;
  const msg = message.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (msg.includes(keyword)) return keyword;
  }
  return null;
}

function isOptOut(message) {
  if (!message) return false;
  const msg = message.toLowerCase().trim();
  return msg === 'stop' || msg === 'unsubscribe' || msg === 'opt out' || msg === 'optout';
}

function programWeeks(program) {
  if (program === '12wk') return 12;
  if (program?.startsWith('6wk')) return 6;
  if (program === 'pcos' || program === '40plus') return 8;
  return 4;
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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglish,
  detectProgram,
  needsEscalation,
  isOptOut,
  programWeeks,
  parseBody,
  corsHeaders,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
};

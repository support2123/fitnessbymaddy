function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/fat\s*loss|weight|shred|burn/i.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone/i.test(lower)) return 'pcos';
  if (/40|forty|menopause|joints|joint/i.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship/i.test(lower)) return '12wk';
  if (/trial|zoom|not\s*sure|try/i.test(lower)) return 'zoom_trial';
  if (/home|bodyweight|no\s*gym/i.test(lower)) return '6wk_home';
  return null;
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex',
  'bulimi', 'not eating', 'faint', 'chest pain', 'heart'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
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

function programCheckoutUrl(program) {
  const map = {
    '6wk_gym': 'shred-6week',
    '6wk_home': 'shred-6week-home',
    '12wk': 'custom-12week',
    'pcos': 'pcos-warrior',
    '40plus': '40plus-strong',
    'zoom_trial': 'zoom-trial',
    'zoom_pack': 'zoom-pack'
  };
  const slug = map[program] || program;
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${slug}`;
}

function programDisplayName(program) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': '$20 Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack'
  };
  return map[program] || program;
}

module.exports = {
  detectMarket,
  detectProgram,
  needsEscalation,
  isOptOut,
  parseBody,
  corsHeaders,
  programCheckoutUrl,
  programDisplayName,
  ESCALATION_KEYWORDS
};

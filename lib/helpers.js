function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/fat\s*loss|weight|shred|burn|lean/i.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone/i.test(lower)) return 'pcos';
  if (/40|menopause|joint|senior|mature/i.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|premium/i.test(lower)) return '12wk';
  if (/trial|zoom|not\s*sure|try|test/i.test(lower)) return 'zoom_trial';
  if (/home|bodyweight|no\s*gym/i.test(lower)) return '6wk_home';
  return null;
}

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnancy', 'pregnant', 'medication', 'medicine',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'not working', 'scam', 'cheat'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

function programLabel(code) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Training',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Pack'
  };
  return labels[code] || code;
}

function programWeeks(code) {
  const weeks = { '6wk_gym': 6, '6wk_home': 6, '12wk': 12, 'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4 };
  return weeks[code] || 6;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) { resolve(req.body); return; }
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve(data); }
    });
    req.on('error', reject);
  });
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = {
  detectMarket, detectProgram, needsEscalation, isOptOut,
  programLabel, programWeeks, parseBody, corsHeaders,
  ESCALATION_KEYWORDS
};

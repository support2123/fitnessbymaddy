function detectMarket(phone) {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'not eating', 'purging',
  'medical', 'surgery', 'hospital',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'lean', 'fat'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'],
  '40plus': ['40', 'menopause', 'joints', 'joint pain', 'senior', 'over 40'],
  '12wk': ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test'],
};

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior',
  '40plus': '40+ Strong',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Session Pack',
};

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  '12wk': 200,
  'pcos': 45,
  '40plus': 50,
  'zoom_trial': 20,
  'zoom_pack': 597,
};

function getProgramWeeks(program) {
  const map = { '6wk_gym': 6, '6wk_home': 6, '12wk': 12, 'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4 };
  return map[program] || 6;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function verifyCron(req) {
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${process.env.CRON_SECRET}`;
}

module.exports = {
  detectMarket,
  maskPhone,
  needsEscalation,
  isOptOut,
  detectProgram,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
  getProgramWeeks,
  jsonResponse,
  verifyCron,
};

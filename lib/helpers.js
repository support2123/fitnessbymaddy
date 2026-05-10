const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pain', 'dizziness', 'pregnant', 'pregnancy',
  'medication', 'eating disorder', 'anorex', 'bulimi', 'dizzy',
  'faint', 'hospital', 'doctor', 'medical',
];

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'lean', 'fat'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', '40+', 'menopause', 'joints', 'joint pain', 'over 40'],
  '12wk': ['custom', '12 week', '12-week', 'serious', 'personalised', 'personalized', 'flagship'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test'],
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
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
  'zoom_pack': 150,
};

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function detectLanguage(market) {
  return market === 'IN' ? 'hinglish' : 'english';
}

function matchProgram(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return program;
    }
  }
  return null;
}

function needsEscalation(messageText) {
  if (!messageText) return false;
  const lower = messageText.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(messageText) {
  if (!messageText) return false;
  const lower = messageText.toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

function getCheckoutUrl(programKey) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${programKey}`;
}

function getIntakeUrl(leadId) {
  return `https://fitnessbymaddy.com/intake.html?lead=${leadId}`;
}

function getCheckinUrl(clientId, weekNo) {
  return `https://fitnessbymaddy.com/checkin.html?c=${clientId}&w=${weekNo}`;
}

function programWeeks(programKey) {
  const map = { '6wk_gym': 6, '6wk_home': 6, '12wk': 12, 'pcos': 6, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4 };
  return map[programKey] || 6;
}

function computeProgramEndDate(startDate, programKey) {
  const weeks = programWeeks(programKey);
  const end = new Date(startDate);
  end.setDate(end.getDate() + weeks * 7);
  return end.toISOString();
}

module.exports = {
  ESCALATION_KEYWORDS,
  PROGRAM_KEYWORDS,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
  detectMarket,
  detectLanguage,
  matchProgram,
  needsEscalation,
  isOptOut,
  getCheckoutUrl,
  getIntakeUrl,
  getCheckinUrl,
  programWeeks,
  computeProgramEndDate,
};

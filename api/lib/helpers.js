function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function classifyIntent(message) {
  if (!message) return null;
  const text = message.toLowerCase().trim();

  const patterns = [
    { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn'], program: '6wk_gym', label: '6-Week Burn & Build' },
    { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
    { keywords: ['40+', '40 plus', '40plus', 'menopause', 'joints', 'joint pain', 'over 40'], program: '40plus', label: '40+ Strong' },
    { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Flagship' },
    { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
    { keywords: ['home', 'no gym', 'home workout', 'bodyweight'], program: '6wk_home', label: '6-Week Home' },
  ];

  for (const p of patterns) {
    if (p.keywords.some(k => text.includes(k))) {
      return { program: p.program, label: p.label };
    }
  }
  return null;
}

const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'not working', 'scam',
];

function needsEscalation(message) {
  if (!message) return false;
  const text = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(k => text.includes(k));
}

function isOptOut(message) {
  if (!message) return false;
  const text = message.toLowerCase().trim();
  return text === 'stop' || text === 'unsubscribe' || text === 'opt out' || text === 'optout';
}

function programPrice(program) {
  const prices = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '12wk': 200,
    'pcos': 45,
    '40plus': 50,
    'zoom_trial': 20,
    'zoom_pack': 99,
  };
  return prices[program] || 0;
}

function programWeeks(program) {
  const weeks = {
    '6wk_gym': 6,
    '6wk_home': 6,
    '12wk': 12,
    'pcos': 6,
    '40plus': 8,
    'zoom_trial': 1,
    'zoom_pack': 4,
  };
  return weeks[program] || 6;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

module.exports = {
  detectMarket,
  classifyIntent,
  needsEscalation,
  isOptOut,
  programPrice,
  programWeeks,
  corsHeaders,
  jsonResponse,
  errorResponse,
};

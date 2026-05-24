const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'purging', 'starving'
];

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'lean', 'cut'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', '40+', 'menopause', 'joints', 'joint pain', 'over 40'],
  '12wk': ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test']
};

function classifyIntent(message) {
  const lower = message.toLowerCase();

  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { type: 'escalation', keyword };
    }
  }

  if (lower === 'stop' || lower === 'unsubscribe') {
    return { type: 'optout' };
  }

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return { type: 'program_match', program };
      }
    }
  }

  return { type: 'unknown' };
}

function programLabel(code) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack'
  };
  return labels[code] || code;
}

function programPrice(code) {
  const prices = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '12wk': 200,
    'pcos': 45,
    '40plus': 50,
    'zoom_trial': 20,
    'zoom_pack': 150
  };
  return prices[code] || 0;
}

function programWeeks(code) {
  const weeks = {
    '6wk_gym': 6,
    '6wk_home': 6,
    '12wk': 12,
    'pcos': 6,
    '40plus': 8,
    'zoom_trial': 1,
    'zoom_pack': 8
  };
  return weeks[code] || 6;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

module.exports = {
  classifyIntent,
  programLabel,
  programPrice,
  programWeeks,
  corsHeaders,
  jsonResponse,
  ESCALATION_KEYWORDS
};

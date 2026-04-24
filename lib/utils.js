function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
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

function isHinglish(market) {
  return market === 'IN';
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/\b(stop|unsubscribe)\b/i.test(lower)) return 'OPT_OUT';

  if (/\b(fat\s*loss|weight|shred|lean|slim|burn)\b/i.test(lower))
    return '6wk_gym';
  if (/\b(home|no\s*gym|bodyweight|at\s*home)\b/i.test(lower))
    return '6wk_home';
  if (/\b(pcos|hormonal|pcod)\b/i.test(lower)) return 'pcos';
  if (/\b(40\+?|forty|menopause|joints|senior)\b/i.test(lower))
    return '40plus';
  if (/\b(custom|12\s*week|serious|transform|flagship)\b/i.test(lower))
    return '12wk';
  if (/\b(trial|zoom|not\s*sure|try|test)\b/i.test(lower))
    return 'zoom_trial';

  return null;
}

const PROGRAM_INFO = {
  '6wk_gym': {
    name: '6-Week Burn & Build (Gym)',
    price: 35,
    checkoutSlug: '6wk-burn-build-gym',
  },
  '6wk_home': {
    name: '6-Week Burn & Build (Home)',
    price: 35,
    checkoutSlug: '6wk-burn-build-home',
  },
  pcos: {
    name: 'PCOS Warrior Program',
    price: 45,
    checkoutSlug: 'pcos-warrior',
  },
  '40plus': {
    name: '40+ Strong Program',
    price: 50,
    checkoutSlug: '40plus-strong',
  },
  '12wk': {
    name: '12-Week Custom Flagship',
    price: 200,
    checkoutSlug: '12wk-flagship',
  },
  zoom_trial: {
    name: 'Zoom Trial Session',
    price: 20,
    checkoutSlug: 'zoom-trial',
  },
  zoom_pack: {
    name: 'Zoom Pack (4 Sessions)',
    price: 60,
    checkoutSlug: 'zoom-4pack',
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
  maskPhone,
  isHinglish,
  needsEscalation,
  classifyIntent,
  PROGRAM_INFO,
  ESCALATION_KEYWORDS,
  corsHeaders,
  jsonResponse,
  errorResponse,
};

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('91') || cleaned.startsWith('0')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  if (/\b(stop|unsubscribe|opt.?out)\b/.test(lower)) return 'OPTOUT';

  const escalation = [
    'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
    'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
    'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
    'medical', 'surgery', 'doctor',
  ];
  if (escalation.some(kw => lower.includes(kw))) return 'ESCALATE';

  if (/\b(fat.?loss|weight|shred|lose|slim|lean)\b/.test(lower)) return '6wk';
  if (/\b(pcos|hormonal|hormone|period|irregular)\b/.test(lower)) return 'pcos';
  if (/\b(40|forty|menopause|joints?|senior|mature)\b/.test(lower)) return '40plus';
  if (/\b(custom|12.?week|serious|flagship|transform)\b/.test(lower)) return '12wk';
  if (/\b(trial|zoom|not sure|try|test|sample)\b/.test(lower)) return 'zoom_trial';

  return null;
}

function programMeta(key) {
  const programs = {
    '6wk': {
      name: '6-Week Burn & Build',
      slug: '6wk_gym',
      price: 97,
      weeks: 6,
      checkoutSlug: '6-week-burn-build',
    },
    pcos: {
      name: 'PCOS Warrior',
      slug: 'pcos',
      price: 45,
      weeks: 6,
      checkoutSlug: 'pcos-warrior',
    },
    '40plus': {
      name: '40+ Strong',
      slug: '40plus',
      price: 50,
      weeks: 6,
      checkoutSlug: '40-plus-strong',
    },
    '12wk': {
      name: '12-Week Flagship',
      slug: '12wk',
      price: 200,
      weeks: 12,
      checkoutSlug: '12-week-flagship',
    },
    zoom_trial: {
      name: 'Zoom Trial Session',
      slug: 'zoom_trial',
      price: 20,
      weeks: 1,
      checkoutSlug: 'zoom-trial',
    },
  };
  return programs[key] || null;
}

function isHinglish(market) {
  return market === 'IN';
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

module.exports = {
  detectMarket,
  maskPhone,
  classifyIntent,
  programMeta,
  isHinglish,
  corsHeaders,
  jsonResponse,
};

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

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  if (/\b(stop|unsubscribe|opt.?out|hatao|band karo)\b/.test(lower)) {
    return 'OPTOUT';
  }

  const escalationWords = [
    'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
    'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
    'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
    'anorex', 'bulimi', 'purge',
  ];
  if (escalationWords.some((w) => lower.includes(w))) {
    return 'ESCALATE';
  }

  if (/\b(fat.?loss|weight|shred|lose|slim|patla|vajan)\b/.test(lower)) return '6wk_gym';
  if (/\b(pcos|hormonal|pcod|period|irregular)\b/.test(lower)) return 'pcos';
  if (/\b(40|forty|menopause|joint|knee|back pain|age)\b/.test(lower)) return '40plus';
  if (/\b(custom|12.?week|serious|dedicated|flagship|personal)\b/.test(lower)) return '12wk';
  if (/\b(trial|zoom|try|not sure|pata nahi|confused|test)\b/.test(lower)) return 'zoom_trial';
  if (/\b(home|ghar|no.?gym|body.?weight|at home)\b/.test(lower)) return '6wk_home';

  return null;
}

function programLabel(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship Custom Program',
    pcos: 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    zoom_trial: '$20 Zoom Trial Session',
    zoom_pack: 'Zoom Session Pack',
  };
  return map[code] || code;
}

function programPrice(code) {
  const map = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '12wk': 200,
    pcos: 45,
    '40plus': 50,
    zoom_trial: 20,
    zoom_pack: 150,
  };
  return map[code] || 0;
}

function checkoutUrl(program) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
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

function parseBody(req) {
  return req.json().catch(() => ({}));
}

module.exports = {
  detectMarket,
  isHinglish,
  classifyIntent,
  programLabel,
  programPrice,
  checkoutUrl,
  corsHeaders,
  jsonResponse,
  parseBody,
};

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
  const msg = message.toLowerCase();

  if (/fat\s*loss|weight|shred|lean|slim|burn/.test(msg)) return '6wk_gym';
  if (/pcos|hormonal|hormone|period|irregular/.test(msg)) return 'pcos';
  if (/40\+?|forty|menopause|joints?|senior|mature/.test(msg)) return '40plus';
  if (/custom|12\s*week|serious|flagship|personali[sz]ed/.test(msg)) return '12wk';
  if (/trial|zoom|not\s*sure|try|test/.test(msg)) return 'zoom_trial';
  if (/home|no\s*gym|bodyweight|at\s*home/.test(msg)) return '6wk_home';

  return null;
}

function isOptOut(message) {
  if (!message) return false;
  const msg = message.toLowerCase().trim();
  return /^(stop|unsubscribe|opt\s*out|cancel|remove\s*me)$/i.test(msg);
}

function isEscalation(message) {
  if (!message) return false;
  const msg = message.toLowerCase();
  const triggers = [
    'injury', 'medical', 'pregnan', 'medication', 'medicine',
    'pain', 'dizz', 'disordered', 'eating disorder', 'anorex', 'bulimi',
    'refund', 'lawyer', 'complaint', "didn't work", 'didnt work',
    'side effect', 'not working', 'scam', 'fraud',
  ];
  return triggers.some(t => msg.includes(t));
}

const PROGRAM_CHECKOUT = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97, slug: '6wk-gym' },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97, slug: '6wk-home' },
  '12wk': { name: '12-Week Flagship Program', price: 200, slug: '12wk-custom' },
  'pcos': { name: 'PCOS Warrior', price: 45, slug: 'pcos-warrior' },
  '40plus': { name: '40+ Strong', price: 50, slug: '40plus-strong' },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, slug: 'zoom-trial' },
  'zoom_pack': { name: 'Zoom Pack (4 sessions)', price: 60, slug: 'zoom-pack' },
};

function getCheckoutUrl(programKey) {
  const prog = PROGRAM_CHECKOUT[programKey];
  if (!prog) return null;
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${prog.slug}`;
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
  isOptOut,
  isEscalation,
  PROGRAM_CHECKOUT,
  getCheckoutUrl,
  corsHeaders,
  jsonResponse,
  errorResponse,
};

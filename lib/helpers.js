function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  if (/\b(stop|unsubscribe|opt.?out|remove)\b/.test(lower)) return 'OPTOUT';

  const escalationWords = ['refund', 'lawyer', 'complaint', "didn't work", 'side effect',
    'injury', 'pregnant', 'pregnancy', 'medication', 'pain', 'dizziness',
    'dizzy', 'eating disorder', 'anorex', 'bulimi', 'medical'];
  for (const word of escalationWords) {
    if (lower.includes(word)) return 'ESCALATE';
  }

  if (/\b(fat.?loss|weight|shred|lean|cut|slim|lose)\b/.test(lower)) return '6wk';
  if (/\b(pcos|hormonal|hormone|period|irregular)\b/.test(lower)) return 'pcos';
  if (/\b(40|forty|menopause|joints?|senior|older)\b/.test(lower)) return '40plus';
  if (/\b(custom|12.?week|serious|flagship|transform|personaliz|personalis)\b/.test(lower)) return '12wk';
  if (/\b(trial|zoom|not sure|try|test|sample)\b/.test(lower)) return 'zoom_trial';
  if (/\b(home|bodyweight|no.?gym|at.?home)\b/.test(lower)) return '6wk_home';
  if (/\b(gym|weights?|lifting)\b/.test(lower)) return '6wk_gym';

  return null;
}

const PROGRAM_INFO = {
  '6wk': { name: '6-Week Burn & Build', price: 97, slug: '6wk_gym' },
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97, slug: '6wk_gym' },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97, slug: '6wk_home' },
  'pcos': { name: 'PCOS Warrior Program', price: 45, slug: 'pcos' },
  '40plus': { name: '40+ Strong Program', price: 50, slug: '40plus' },
  '12wk': { name: '12-Week Custom Training', price: 200, slug: '12wk' },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, slug: 'zoom_trial' },
  'zoom_pack': { name: 'Zoom Session Pack', price: 100, slug: 'zoom_pack' }
};

function getProgramInfo(key) {
  return PROGRAM_INFO[key] || null;
}

function isHinglish(market) {
  return market === 'IN';
}

function getWelcomeMessage(market) {
  if (isHinglish(market)) {
    return "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?";
  }
  return "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";
}

function getNudgeMessage(market) {
  if (isHinglish(market)) {
    return "Hey! Maddy ka $20 trial session try karo — 1 Zoom call mein pura plan mil jayega. Interested? 💪";
  }
  return "Hey! Try Maddy's $20 trial session — get a full plan in just one Zoom call. Interested? 💪";
}

function getProgramMessage(intent, market) {
  const info = getProgramInfo(intent);
  if (!info) return null;

  if (isHinglish(market)) {
    return `Great choice! 🔥 ${info.name} — $${info.price} mein full program milega.\n\nCheckout karo: https://fitnessbymaddyy.exlyapp.com/checkout/${info.slug}\n\nIntake form bhi fill karo taaki Maddy tera plan bana sake!`;
  }
  return `Great choice! 🔥 The ${info.name} is $${info.price} and includes the full program.\n\nCheckout here: https://fitnessbymaddyy.exlyapp.com/checkout/${info.slug}\n\nAlso fill out the intake form so Maddy can build your plan!`;
}

function corsHeaders(origin) {
  const allowed = ['https://www.fitnessbymaddy.com', 'https://fitnessbymaddy.com'];
  const effectiveOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': effectiveOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

function jsonResponse(res, data, status = 200) {
  res.status(status).json(data);
}

function errorResponse(res, message, status = 400) {
  res.status(status).json({ error: message });
}

function calculateProgramEndDate(program, startDate) {
  const start = new Date(startDate);
  const weeks = program === '12wk' ? 12 : 6;
  start.setDate(start.getDate() + weeks * 7);
  return start.toISOString();
}

module.exports = {
  detectMarket,
  maskPhone,
  classifyIntent,
  getProgramInfo,
  isHinglish,
  getWelcomeMessage,
  getNudgeMessage,
  getProgramMessage,
  corsHeaders,
  jsonResponse,
  errorResponse,
  calculateProgramEndDate
};

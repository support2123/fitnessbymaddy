function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  if (/\b(stop|unsubscribe|opt.?out|cancel)\b/.test(lower)) return 'OPT_OUT';

  if (/\b(refund|lawyer|complaint|didn'?t work|side effect)\b/.test(lower)) return 'ESCALATE';
  if (/\b(injury|medical|pregnant|pregnancy|medication|pain|dizz|disordered)\b/.test(lower)) return 'ESCALATE_MEDICAL';

  if (/\b(fat.?loss|weight|shred|lose|slim)\b/.test(lower)) return '6wk_gym';
  if (/\b(pcos|hormonal|hormone)\b/.test(lower)) return 'pcos';
  if (/\b(40|forty|menopause|joints|joint)\b/.test(lower)) return '40plus';
  if (/\b(custom|12.?week|serious|flagship)\b/.test(lower)) return '12wk';
  if (/\b(trial|zoom|not sure|try)\b/.test(lower)) return 'zoom_trial';
  if (/\b(home|bodyweight|no gym|no.?equipment)\b/.test(lower)) return '6wk_home';

  return null;
}

const PROGRAM_DETAILS = {
  '6wk_gym':     { name: '6-Week Burn & Build (Gym)', price: 97,  weeks: 6,  checkoutSlug: '6wk-gym' },
  '6wk_home':    { name: '6-Week Burn & Build (Home)', price: 97,  weeks: 6,  checkoutSlug: '6wk-home' },
  '12wk':        { name: '12-Week Flagship Program',   price: 200, weeks: 12, checkoutSlug: '12wk-custom' },
  'pcos':        { name: 'PCOS Warrior Program',        price: 45,  weeks: 6,  checkoutSlug: 'pcos-warrior' },
  '40plus':      { name: '40+ Strong Program',          price: 50,  weeks: 6,  checkoutSlug: '40plus-strong' },
  'zoom_trial':  { name: 'Zoom Trial Session',          price: 20,  weeks: 1,  checkoutSlug: 'zoom-trial' },
  'zoom_pack':   { name: 'Zoom Session Pack',           price: 80,  weeks: 4,  checkoutSlug: 'zoom-pack' },
};

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
  maskPhone,
  detectMarket,
  isHinglish,
  classifyIntent,
  PROGRAM_DETAILS,
  jsonResponse,
  verifyCron,
};

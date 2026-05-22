function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglishMarket(market) {
  return market === 'IN';
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  if (/\b(stop|unsubscribe|opt.?out)\b/.test(lower)) return 'OPT_OUT';

  if (/\b(refund|lawyer|complaint|didn'?t work|side effect)\b/.test(lower)) return 'ESCALATE';
  if (/\b(injury|medical|pregnan|medication|pain|dizzi|eating disorder)\b/.test(lower)) return 'ESCALATE_MEDICAL';

  if (/\b(fat.?loss|weight|shred|lean|cut)\b/.test(lower)) return '6wk_gym';
  if (/\b(pcos|hormonal|period|irregular)\b/.test(lower)) return 'pcos';
  if (/\b(40|menopause|joints|senior|age)\b/.test(lower)) return '40plus';
  if (/\b(custom|12.?week|serious|flagship|transform)\b/.test(lower)) return '12wk';
  if (/\b(trial|zoom|not sure|test|try)\b/.test(lower)) return 'zoom_trial';
  if (/\b(home|bodyweight|no.?gym|at.?home)\b/.test(lower)) return '6wk_home';

  return null;
}

const PROGRAM_INFO = {
  '6wk_gym': { name: '6 Week Burn & Build (Gym)', price: 97, weeks: 6 },
  '6wk_home': { name: '6 Week Burn & Build (Home)', price: 97, weeks: 6 },
  '12wk': { name: '12 Week Custom Training', price: 200, weeks: 12 },
  'pcos': { name: 'PCOS Warrior Program', price: 45, weeks: 8 },
  '40plus': { name: '40+ Strong Program', price: 50, weeks: 8 },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, weeks: 1 },
  'zoom_pack': { name: 'Zoom Session Pack', price: 80, weeks: 4 },
};

function getProgramEndDate(startDate, program) {
  const info = PROGRAM_INFO[program];
  if (!info) return null;
  const end = new Date(startDate);
  end.setDate(end.getDate() + info.weeks * 7);
  return end.toISOString();
}

function rateLimitKey(phone) {
  return `ratelimit:${phone}`;
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglishMarket,
  classifyIntent,
  PROGRAM_INFO,
  getProgramEndDate,
  rateLimitKey,
};

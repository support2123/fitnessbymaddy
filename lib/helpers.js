export function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

export function isHinglish(market) {
  return market === 'IN';
}

export function classifyIntent(message) {
  const msg = (message || '').toLowerCase().trim();

  if (/\b(fat\s*loss|weight|shred|lose|slim)\b/.test(msg)) return '6wk_gym';
  if (/\b(pcos|hormonal|pcod|irregular)\b/.test(msg)) return 'pcos';
  if (/\b(40|forty|menopause|joints|senior|older)\b/.test(msg)) return '40plus';
  if (/\b(custom|12\s*week|serious|flagship|personalise|personalize)\b/.test(msg)) return '12wk';
  if (/\b(trial|zoom|not\s*sure|try|test)\b/.test(msg)) return 'zoom_trial';
  if (/\b(home|no\s*gym|bodyweight|at\s*home)\b/.test(msg)) return '6wk_home';

  return null;
}

export function getProgramDetails(program) {
  const programs = {
    '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97, weeks: 6 },
    '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97, weeks: 6 },
    '12wk': { name: '12-Week Custom Program', price: 200, weeks: 12 },
    'pcos': { name: 'PCOS Warrior Program', price: 45, weeks: 8 },
    '40plus': { name: '40+ Strong Program', price: 50, weeks: 8 },
    'zoom_trial': { name: 'Zoom Trial Session', price: 20, weeks: 1 },
    'zoom_pack': { name: 'Zoom Session Pack', price: 150, weeks: 4 },
  };
  return programs[program] || null;
}

export function getCheckoutUrl(program) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
}

export function getIntakeUrl(leadId) {
  return `https://fitnessbymaddy.com/intake.html?lead=${leadId}`;
}

export function getCheckinUrl(clientId, weekNo) {
  return `https://fitnessbymaddy.com/checkin.html?c=${clientId}&w=${weekNo}`;
}

export function jsonResponse(res, data, status = 200) {
  res.status(status).json(data);
}

export function corsHeaders(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

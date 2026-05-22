export function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export function handleCors(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

export function parseBody(req) {
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

export function routeProgram(message) {
  const lower = (message || '').toLowerCase();

  if (/fat\s*loss|weight|shred|slim|lean/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone|period|irregular/.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joint|joints/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|transform|flagship/.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try|test/.test(lower)) return 'zoom_trial';
  if (/home|no\s*gym|bodyweight/.test(lower)) return '6wk_home';

  return null;
}

export const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Pack (4 Sessions)'
};

export const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  '12wk': 200,
  'pcos': 45,
  '40plus': 50,
  'zoom_trial': 20,
  'zoom_pack': 70
};

export function programWeeks(program) {
  if (program === '12wk') return 12;
  if (program.startsWith('6wk')) return 6;
  if (program === 'pcos' || program === '40plus') return 6;
  return 4;
}

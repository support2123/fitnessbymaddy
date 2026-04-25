function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function handleCors(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

function jsonError(res, msg, status) {
  return res.status(status || 400).json({ error: msg });
}

function jsonOk(res, data) {
  return res.status(200).json({ ok: true, ...data });
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'medical', 'doctor', 'hospital', 'surgery',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/\b(stop|unsubscribe|opt.?out|cancel)\b/.test(lower)) return 'OPT_OUT';

  if (/\b(fat.?loss|weight|shred|lean|cut|slim)\b/.test(lower)) return '6wk_gym';
  if (/\b(pcos|hormonal|hormone|period|irregular)\b/.test(lower)) return 'pcos';
  if (/\b(40\+?|forty|menopause|joints|senior|mature)\b/.test(lower)) return '40plus';
  if (/\b(custom|12.?week|serious|flagship|premium|full)\b/.test(lower)) return '12wk';
  if (/\b(home|no.?gym|bodyweight|at.?home)\b/.test(lower)) return '6wk_home';
  if (/\b(trial|zoom|not.?sure|try|test|demo)\b/.test(lower)) return 'zoom_trial';

  return null;
}

const PROGRAM_INFO = {
  '6wk_gym': { name: '6-Week Burn & Build', price: '$97', slug: '6-week-shred' },
  '6wk_home': { name: '6-Week Home Shred', price: '$79', slug: '6-week-home' },
  '12wk': { name: '12-Week Custom Program', price: '$200', slug: '12-week-custom' },
  pcos: { name: 'PCOS Warrior Program', price: '$45', slug: 'pcos-warrior' },
  '40plus': { name: '40+ Strong Program', price: '$50', slug: '40-plus-strong' },
  zoom_trial: { name: 'Zoom Trial Session', price: '$20', slug: 'zoom-trial' },
  zoom_pack: { name: 'Zoom Session Pack', price: '$150', slug: 'zoom-pack' },
};

function verifyCronSecret(req) {
  const auth = req.headers.authorization;
  return auth === `Bearer ${process.env.CRON_SECRET}`;
}

module.exports = {
  handleCors,
  jsonError,
  jsonOk,
  needsEscalation,
  classifyIntent,
  PROGRAM_INFO,
  verifyCronSecret,
};

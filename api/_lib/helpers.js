function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) return resolve(req.body);
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  if (/\b(stop|unsubscribe|opt.?out)\b/.test(lower)) return 'OPTOUT';

  if (/\b(fat.?loss|weight|shred|lean|cut)\b/.test(lower)) return '6wk_gym';
  if (/\b(pcos|hormonal|hormone|period|irregular)\b/.test(lower)) return 'pcos';
  if (/\b(40|forty|menopause|joints|joint|mature)\b/.test(lower)) return '40plus';
  if (/\b(custom|12.?week|serious|full|flagship)\b/.test(lower)) return '12wk';
  if (/\b(trial|zoom|not sure|try|test|beginner)\b/.test(lower)) return 'zoom_trial';
  if (/\b(home|no.?gym|bodyweight|apartment)\b/.test(lower)) return '6wk_home';

  return null;
}

function programLabel(code) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Program',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Coaching Pack',
  };
  return labels[code] || code;
}

function programPrice(code) {
  const prices = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '12wk': 200,
    'pcos': 45,
    '40plus': 50,
    'zoom_trial': 20,
    'zoom_pack': 597,
  };
  return prices[code] || 0;
}

function weeksBetween(start, end) {
  const ms = new Date(end) - new Date(start);
  return Math.floor(ms / (7 * 24 * 60 * 60 * 1000));
}

module.exports = {
  cors,
  parseBody,
  classifyIntent,
  programLabel,
  programPrice,
  weeksBetween,
};

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) return resolve(req.body);
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function classifyLeadIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/stop|unsubscribe|opt.?out/i.test(lower)) return 'OPTOUT';
  if (/fat.?loss|weight|shred|slim|lean/i.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone|period|irregular/i.test(lower)) return 'pcos';
  if (/40|forty|menopause|joints|knee|back pain|senior/i.test(lower)) return '40plus';
  if (/custom|12.?week|serious|flagship|transform/i.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try|test|sample/i.test(lower)) return 'zoom_trial';
  if (/home|no.?gym|bodyweight|at home/i.test(lower)) return '6wk_home';

  return null;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Pack'
};

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  '12wk': 200,
  'pcos': 45,
  '40plus': 50,
  'zoom_trial': 20,
  'zoom_pack': 80
};

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) cleaned = '+91' + cleaned;
    else cleaned = '+' + cleaned;
  }
  return cleaned;
}

module.exports = {
  parseBody,
  corsHeaders,
  json,
  classifyLeadIntent,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
  normalizePhone
};

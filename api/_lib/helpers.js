function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) { resolve(req.body); return; }
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve(data); }
    });
    req.on('error', reject);
  });
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function programDuration(program) {
  const durations = {
    '6wk_gym': 42,
    '6wk_home': 42,
    '12wk': 84,
    'pcos': 42,
    '40plus': 42,
    'zoom_trial': 7,
    'zoom_pack': 30,
  };
  return durations[program] || 42;
}

function mapKeywordToProgram(text) {
  const lower = (text || '').toLowerCase();
  if (/fat\s*loss|weight|shred|lean|cut/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|period|cycle/.test(lower)) return 'pcos';
  if (/40|menopause|joints|senior|knee/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|transform/.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try|test/.test(lower)) return 'zoom_trial';
  if (/home|no\s*gym|bodyweight/.test(lower)) return '6wk_home';
  return null;
}

function programLabel(program) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack',
  };
  return labels[program] || program;
}

function programPrice(program) {
  const prices = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '12wk': 200,
    'pcos': 45,
    '40plus': 50,
    'zoom_trial': 20,
    'zoom_pack': 150,
  };
  return prices[program] || 0;
}

module.exports = {
  parseBody,
  cors,
  json,
  programDuration,
  mapKeywordToProgram,
  programLabel,
  programPrice,
};

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

function parseBody(req) {
  if (req.body) return req.body;
  return {};
}

function programDuration(program) {
  const durations = {
    '6wk_gym': 42,
    '6wk_home': 42,
    '12wk': 84,
    'pcos': 42,
    '40plus': 42,
    'zoom_trial': 7,
    'zoom_pack': 28
  };
  return durations[program] || 42;
}

function programLabel(program) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship Program',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Pack'
  };
  return labels[program] || program;
}

function weekNumber(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diff = now - start;
  return Math.max(1, Math.ceil(diff / (7 * 24 * 60 * 60 * 1000)));
}

module.exports = { cors, parseBody, programDuration, programLabel, weekNumber };

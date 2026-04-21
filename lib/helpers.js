function json(res, data, status = 200) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json(data);
}

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

function verifyCronSecret(req) {
  const auth = req.headers.authorization;
  if (!auth) return false;
  return auth === `Bearer ${process.env.CRON_SECRET}`;
}

function parseProgramDuration(program) {
  const DURATIONS = {
    '6wk_gym': 42,
    '6wk_home': 42,
    '12wk': 84,
    'pcos': 42,
    '40plus': 42,
    'zoom_trial': 7,
    'zoom_pack': 28,
  };
  return DURATIONS[program] || 42;
}

module.exports = { json, cors, verifyCronSecret, parseProgramDuration };

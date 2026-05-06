function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://fitnessbymaddy.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    cors(res);
    res.status(204).end();
    return true;
  }
  cors(res);
  return false;
}

function verifyCron(req) {
  const secret = req.headers['authorization'];
  return secret === `Bearer ${process.env.CRON_SECRET}`;
}

module.exports = { maskPhone, cors, handleOptions, verifyCron };

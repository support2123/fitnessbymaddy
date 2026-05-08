// Detect market from phone country code
function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

// Mask phone for logging: +91XXX...374
function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

// Detect program interest from message keywords
function detectProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  if (/fat\s*loss|weight|shred|burn/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone/.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joints|joint/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship/.test(lower)) return '12wk';
  if (/trial|zoom|not\s*sure|try/.test(lower)) return 'zoom_trial';
  if (/home|no\s*gym|bodyweight/.test(lower)) return '6wk_home';
  return null;
}

// Check if message should trigger escalation to Maddy
const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'condition', 'pregnant', 'pregnancy',
  'medication', 'medicine', 'pain', 'dizzy', 'dizziness', 'faint',
  'eating disorder', 'anorex', 'bulimi', 'purge', 'refund',
  'lawyer', 'legal', 'complaint', 'didn\'t work', 'not working',
  'side effect', 'stop', 'unsubscribe', 'cancel'
];

function shouldEscalate(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

// Check if user wants to opt out
function isOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

// Program metadata
const PROGRAMS = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97, duration_weeks: 6 },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97, duration_weeks: 6 },
  '12wk': { name: '12-Week Custom Training', price: 200, duration_weeks: 12 },
  'pcos': { name: 'PCOS Warrior', price: 45, duration_weeks: 8 },
  '40plus': { name: '40+ Strong', price: 50, duration_weeks: 8 },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, duration_weeks: 1 },
  'zoom_pack': { name: 'Zoom Pack (4 sessions)', price: 70, duration_weeks: 4 }
};

function getProgramMeta(program) {
  return PROGRAMS[program] || null;
}

// Build Hinglish vs English greeting based on market
function getLanguage(market) {
  return market === 'IN' ? 'hinglish' : 'english';
}

// Parse JSON body from request
async function parseBody(req) {
  return new Promise((resolve, reject) => {
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

// Parse URL query params
function parseQuery(url) {
  const params = {};
  const queryString = url.split('?')[1];
  if (!queryString) return params;
  for (const pair of queryString.split('&')) {
    const [key, value] = pair.split('=');
    params[decodeURIComponent(key)] = decodeURIComponent(value || '');
  }
  return params;
}

// CORS preflight handler
function handleCors(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.status(200).end();
    return true;
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  return false;
}

module.exports = {
  detectMarket,
  maskPhone,
  detectProgram,
  shouldEscalate,
  isOptOut,
  getProgramMeta,
  getLanguage,
  parseBody,
  parseQuery,
  handleCors,
  PROGRAMS
};

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('91') || cleaned.startsWith('091')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  if (/\b(stop|unsubscribe|opt.?out|cancel)\b/.test(lower)) return 'OPTOUT';

  const escalationKeywords = [
    'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
    'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
    'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
    'medical condition', 'surgery', 'heart problem', 'diabetes'
  ];
  for (const kw of escalationKeywords) {
    if (lower.includes(kw)) return 'ESCALATE';
  }

  if (/\b(fat.?loss|weight|shred|lean|cut|slim|burn)\b/.test(lower)) return '6wk';
  if (/\b(pcos|hormonal|hormone|irregular.?period)\b/.test(lower)) return 'pcos';
  if (/\b(40|forty|menopause|joints|joint.?pain|senior)\b/.test(lower)) return '40plus';
  if (/\b(custom|12.?week|serious|transform|flagship|personali[sz]ed)\b/.test(lower)) return '12wk';
  if (/\b(trial|zoom|not.?sure|try|test|sample)\b/.test(lower)) return 'zoom_trial';

  return null;
}

function programLabel(code) {
  const map = {
    '6wk': '6-Week Burn & Build',
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Pack'
  };
  return map[code] || code;
}

function programPrice(code) {
  const map = {
    '6wk': 97,
    '6wk_gym': 97,
    '6wk_home': 97,
    '12wk': 200,
    'pcos': 45,
    '40plus': 50,
    'zoom_trial': 20,
    'zoom_pack': 80
  };
  return map[code] || 0;
}

function programWeeks(code) {
  const map = {
    '6wk': 6, '6wk_gym': 6, '6wk_home': 6,
    '12wk': 12,
    'pcos': 6, '40plus': 8,
    'zoom_trial': 1, 'zoom_pack': 4
  };
  return map[code] || 6;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) { resolve(req.body); return; }
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        const params = new URLSearchParams(data);
        resolve(Object.fromEntries(params));
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

function json(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

module.exports = {
  detectMarket, classifyIntent, programLabel, programPrice,
  programWeeks, parseBody, corsHeaders, json
};

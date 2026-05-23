function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const clean = phone.replace(/[^0-9]/g, '');
  if (clean.startsWith('91')) return 'IN';
  if (clean.startsWith('971')) return 'UAE';
  if (clean.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function detectProgramInterest(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/pcos|hormonal|hormone/.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joints?|joint pain/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|transform/.test(lower)) return '12wk';
  if (/fat\s*loss|weight|shred|burn|lean|cut/.test(lower)) return '6wk_gym';
  if (/home|no\s*gym|bodyweight/.test(lower)) return '6wk_home';
  if (/trial|zoom|not\s*sure|try/.test(lower)) return 'zoom_trial';

  return null;
}

function getProgramName(code) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack'
  };
  return names[code] || code;
}

function getProgramCheckoutUrl(program) {
  const urls = {
    '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-gym',
    '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
    '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
    'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
    '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
    'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
    'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
  };
  return urls[program] || urls['zoom_trial'];
}

function getProgramDurationWeeks(program) {
  const durations = {
    '6wk_gym': 6,
    '6wk_home': 6,
    '12wk': 12,
    'pcos': 8,
    '40plus': 8,
    'zoom_trial': 1,
    'zoom_pack': 4
  };
  return durations[program] || 6;
}

function isHinglishMarket(market) {
  return market === 'IN';
}

function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body) {
      resolve(req.body);
      return;
    }
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = {
  detectMarket,
  detectProgramInterest,
  getProgramName,
  getProgramCheckoutUrl,
  getProgramDurationWeeks,
  isHinglishMarket,
  parseBody,
  corsHeaders
};

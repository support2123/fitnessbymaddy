export function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

export function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

export function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/fat\s*loss|weight|shred|lean/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone/.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joints|senior/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|transform/.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try/.test(lower)) return 'zoom_trial';
  if (/home|no\s*gym|bodyweight/.test(lower)) return '6wk_home';
  return null;
}

export function isEscalationTrigger(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const triggers = [
    'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
    'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulimi',
    'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
    'not working', 'scam', 'fraud',
  ];
  return triggers.some(t => lower.includes(t));
}

export function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

export function programLabel(code) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship Program',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack',
  };
  return labels[code] || code;
}

export function programPrice(code) {
  const prices = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '12wk': 200,
    'pcos': 45,
    '40plus': 50,
    'zoom_trial': 20,
    'zoom_pack': 150,
  };
  return prices[code] || 0;
}

export function weeksBetween(start, end) {
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.floor((end - start) / msPerWeek) + 1;
}

export function jsonResponse(res, status, body) {
  res.status(status).json(body);
}

export function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) {
      resolve(req.body);
      return;
    }
    let data = '';
    req.on('data', chunk => { data += chunk; });
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

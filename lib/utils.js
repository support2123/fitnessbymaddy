function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const clean = phone.replace('+', '');
  if (clean.startsWith('91')) return 'IN';
  if (clean.startsWith('971')) return 'UAE';
  if (clean.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function routeProgram(text) {
  const lower = (text || '').toLowerCase();
  if (/fat\s*loss|weight|shred|burn/.test(lower)) return { program: '6wk_gym', name: '6-Week Burn & Build', price: 97 };
  if (/pcos|hormonal|hormone/.test(lower)) return { program: 'pcos', name: 'PCOS Warrior', price: 45 };
  if (/40\+?|menopause|joints|senior/.test(lower)) return { program: '40plus', name: '40+ Strong', price: 50 };
  if (/custom|12\s*week|serious|flagship/.test(lower)) return { program: '12wk', name: '12-Week Flagship', price: 200 };
  if (/trial|zoom|not sure|try/.test(lower)) return { program: 'zoom_trial', name: 'Zoom Trial', price: 20 };
  if (/home|no\s*gym|bodyweight/.test(lower)) return { program: '6wk_home', name: '6-Week Home', price: 97 };
  return null;
}

function isHinglish(market) {
  return market === 'IN';
}

function weekNumber(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diff = now - start;
  return Math.max(1, Math.ceil(diff / (7 * 24 * 60 * 60 * 1000)));
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

module.exports = { maskPhone, detectMarket, routeProgram, isHinglish, weekNumber, jsonResponse, corsHeaders };

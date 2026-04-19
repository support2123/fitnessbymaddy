function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

function parseBody(req) {
  return req.json();
}

function routeProgram(text) {
  const lower = text.toLowerCase();
  if (/fat\s*loss|weight|shred|slim|lean/.test(lower)) {
    return { program: '6wk_gym', name: '6-Week Burn & Build', price: 97 };
  }
  if (/pcos|hormonal|period|cycle/.test(lower)) {
    return { program: 'pcos', name: 'PCOS Warrior', price: 45 };
  }
  if (/40|forty|menopause|joint|senior/.test(lower)) {
    return { program: '40plus', name: '40+ Strong', price: 50 };
  }
  if (/custom|12\s*week|serious|flagship|transform/.test(lower)) {
    return { program: '12wk', name: '12-Week Flagship', price: 200 };
  }
  if (/trial|zoom|not sure|try|test/.test(lower)) {
    return { program: 'zoom_trial', name: 'Zoom Trial Session', price: 20 };
  }
  return null;
}

function generateToken(length = 32) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

module.exports = { jsonResponse, errorResponse, parseBody, routeProgram, generateToken };

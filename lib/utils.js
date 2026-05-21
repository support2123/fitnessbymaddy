function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

function classifyIntent(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  if (/fat\s*loss|weight|shred|slim|lean|burn/i.test(lower)) {
    return { program: '6wk_gym', name: '6-Week Burn & Build' };
  }
  if (/pcos|hormonal|hormone|period|irregular/i.test(lower)) {
    return { program: 'pcos', name: 'PCOS Warrior' };
  }
  if (/40|forty|menopause|joints|joint|senior|mature/i.test(lower)) {
    return { program: '40plus', name: '40+ Strong' };
  }
  if (/custom|12\s*week|serious|premium|flagship|personaliz/i.test(lower)) {
    return { program: '12wk', name: '12-Week Custom Training' };
  }
  if (/trial|zoom|not sure|try|test|demo/i.test(lower)) {
    return { program: 'zoom_trial', name: 'Zoom Trial Session' };
  }
  if (/home|no\s*gym|bodyweight|at\s*home/i.test(lower)) {
    return { program: '6wk_home', name: '6-Week Home Program' };
  }

  return null;
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': 'https://fitnessbymaddy.com',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function programDurationWeeks(program) {
  const durations = {
    '6wk_gym': 6,
    '6wk_home': 6,
    '12wk': 12,
    'pcos': 6,
    '40plus': 6,
    'zoom_trial': 1,
    'zoom_pack': 4,
  };
  return durations[program] || 6;
}

module.exports = {
  detectMarket,
  isHinglish,
  classifyIntent,
  isOptOut,
  corsHeaders,
  jsonResponse,
  programDurationWeeks,
};

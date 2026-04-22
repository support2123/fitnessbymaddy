function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function classifyIntent(message) {
  const lower = (message || '').toLowerCase();

  if (/\b(stop|unsubscribe|opt.?out)\b/.test(lower)) {
    return { intent: 'optout', program: null };
  }

  const escalationPatterns = [
    /\b(injur|medical|pregnan|medication|medicine|doctor|surgery)\b/,
    /\b(pain|dizz|faint|vomit|bleed|disorder|eating disorder|anorexi|bulimi)\b/,
    /\b(refund|lawyer|complaint|didn.?t work|side effect|scam)\b/,
  ];
  for (const pat of escalationPatterns) {
    if (pat.test(lower)) {
      return { intent: 'escalation', program: null, reason: pat.source };
    }
  }

  if (/\b(fat.?loss|weight|shred|lean|cut|slim|belly)\b/.test(lower)) {
    return { intent: 'program', program: '6wk_gym' };
  }
  if (/\b(pcos|hormonal|hormone|period|irregular)\b/.test(lower)) {
    return { intent: 'program', program: 'pcos' };
  }
  if (/\b(40|forty|menopause|joint|knee|back pain|senior)\b/.test(lower)) {
    return { intent: 'program', program: '40plus' };
  }
  if (/\b(custom|12.?week|serious|transform|flagship|premium)\b/.test(lower)) {
    return { intent: 'program', program: '12wk' };
  }
  if (/\b(trial|zoom|not sure|try|test|sample)\b/.test(lower)) {
    return { intent: 'program', program: 'zoom_trial' };
  }
  if (/\b(home|no.?gym|bodyweight|no equipment)\b/.test(lower)) {
    return { intent: 'program', program: '6wk_home' };
  }

  return { intent: 'unknown', program: null };
}

const PROGRAM_INFO = {
  '6wk_gym': {
    name: '6-Week Burn & Build (Gym)',
    price: '$97',
    checkout: 'program-6wk-gym',
    duration_weeks: 6,
  },
  '6wk_home': {
    name: '6-Week Burn & Build (Home)',
    price: '$97',
    checkout: 'program-6wk-home',
    duration_weeks: 6,
  },
  '12wk': {
    name: '12-Week Custom Flagship',
    price: '$200',
    checkout: 'program-12wk',
    duration_weeks: 12,
  },
  pcos: {
    name: 'PCOS Warrior Program',
    price: '$45',
    checkout: 'program-pcos',
    duration_weeks: 8,
  },
  '40plus': {
    name: '40+ Strong Program',
    price: '$50',
    checkout: 'program-40plus',
    duration_weeks: 8,
  },
  zoom_trial: {
    name: 'Zoom Trial Session',
    price: '$20',
    checkout: 'program-trial',
    duration_weeks: 1,
  },
  zoom_pack: {
    name: 'Zoom Pack (4 Sessions)',
    price: '$70',
    checkout: 'program-zoom-pack',
    duration_weeks: 4,
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function corsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

module.exports = {
  detectMarket,
  maskPhone,
  classifyIntent,
  PROGRAM_INFO,
  jsonResponse,
  corsResponse,
};

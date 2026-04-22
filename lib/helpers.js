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

function routeProgram(message) {
  if (!message) return null;
  const msg = message.toLowerCase();
  if (/fat\s*loss|weight|shred|slim|lean/.test(msg)) return { program: '6wk_gym', name: '6-Week Burn & Build', price: 97 };
  if (/pcos|hormonal|hormone|period|irregular/.test(msg)) return { program: 'pcos', name: 'PCOS Warrior', price: 45 };
  if (/40\+?|forty|menopause|joints|senior|over 40/.test(msg)) return { program: '40plus', name: '40+ Strong', price: 50 };
  if (/custom|12\s*week|serious|flagship|premium|personal/.test(msg)) return { program: '12wk', name: '12-Week Flagship', price: 200 };
  if (/trial|zoom|not sure|try|test|start/.test(msg)) return { program: 'zoom_trial', name: 'Zoom Trial', price: 20 };
  if (/home|no gym|bodyweight|at home/.test(msg)) return { program: '6wk_home', name: '6-Week Home Program', price: 97 };
  return null;
}

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulim',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'not working', 'hurt', 'doctor', 'hospital', 'surgery'
];

function needsEscalation(message) {
  if (!message) return false;
  const msg = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => msg.includes(kw));
}

function isOptOut(message) {
  if (!message) return false;
  const msg = message.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(msg);
}

function programDuration(program) {
  const durations = {
    '6wk_gym': 42,
    '6wk_home': 42,
    '12wk': 84,
    'pcos': 42,
    '40plus': 42,
    'zoom_trial': 7,
    'zoom_pack': 30
  };
  return durations[program] || 42;
}

function getWelcomeMessage(market) {
  if (market === 'IN') {
    return "Hi! Maddy's team here \u{1F44B} Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?";
  }
  return "Hi! Maddy's team here \u{1F44B} What's your fitness goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";
}

function getNudgeMessage(market) {
  if (market === 'IN') {
    return "Hey! Maddy ka $20 Zoom trial try karo — 1 session mein samajh aa jayega ki program kaisa hoga. Interested? \u{1F4AA}";
  }
  return "Hey! Try Maddy's $20 Zoom trial — one session to experience the coaching style. Interested? \u{1F4AA}";
}

module.exports = {
  detectMarket,
  maskPhone,
  routeProgram,
  needsEscalation,
  isOptOut,
  programDuration,
  getWelcomeMessage,
  getNudgeMessage
};

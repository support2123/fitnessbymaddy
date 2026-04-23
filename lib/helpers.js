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
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'not eating', 'faint', 'chest pain',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOutMessage(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/fat\s*loss|weight|shred|lean/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone/.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joint/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|personali/.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try/.test(lower)) return 'zoom_trial';
  if (/home|no\s*gym|body\s*weight/.test(lower)) return '6wk_home';

  return null;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Session Pack',
};

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  '12wk': 200,
  'pcos': 45,
  '40plus': 50,
  'zoom_trial': 20,
  'zoom_pack': 120,
};

const PROGRAM_DURATIONS_WEEKS = {
  '6wk_gym': 6,
  '6wk_home': 6,
  '12wk': 12,
  'pcos': 6,
  '40plus': 6,
  'zoom_trial': 1,
  'zoom_pack': 8,
};

function getCheckoutUrl(programKey) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${programKey}`;
}

function getIntakeUrl(leadId) {
  return `https://www.fitnessbymaddy.com/intake.html?lead=${leadId}`;
}

function getCheckinUrl(clientId, weekNo) {
  return `https://www.fitnessbymaddy.com/checkin.html?c=${clientId}&w=${weekNo}`;
}

function buildWelcomeReply(market) {
  if (market === 'IN') {
    return "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?";
  }
  return "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";
}

function buildQualifiedReply(programKey, market, leadId) {
  const name = PROGRAM_NAMES[programKey] || programKey;
  const price = PROGRAM_PRICES[programKey] || '?';
  const checkoutUrl = getCheckoutUrl(programKey);
  const intakeUrl = getIntakeUrl(leadId);

  if (market === 'IN') {
    return `Great choice! 💪 ${name} ($${price}) aapke liye perfect hai.\n\nCheckout: ${checkoutUrl}\n\nAur yeh intake form bhi fill kardo taaki Maddy aapka plan bana sake:\n${intakeUrl}`;
  }
  return `Great choice! 💪 ${name} ($${price}) is perfect for your goals.\n\nCheckout here: ${checkoutUrl}\n\nAlso fill out this quick intake form so Maddy can build your plan:\n${intakeUrl}`;
}

module.exports = {
  detectMarket,
  maskPhone,
  needsEscalation,
  isOptOutMessage,
  classifyIntent,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
  PROGRAM_DURATIONS_WEEKS,
  getCheckoutUrl,
  getIntakeUrl,
  getCheckinUrl,
  buildWelcomeReply,
  buildQualifiedReply,
};

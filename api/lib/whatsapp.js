const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function getLanguage(market) {
  return market === 'IN' ? 'hinglish' : 'english';
}

async function sendTemplate(phone, templateName, params = {}) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/\D/g, ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    source: 'fitnessbymaddy-automation',
    media: params.media || {},
    buttons: params.buttons || [],
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`WhatsApp send failed for ${maskPhone(phone)}: ${res.status} ${text}`);
    throw new Error(`WhatsApp send failed: ${res.status}`);
  }

  return res.json();
}

async function sendText(phone, message) {
  return sendTemplate(phone, 'text_message', {
    templateParams: [message],
  });
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulim',
  'not eating', 'vomit', 'faint',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'burn', 'lean'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'pcod'],
  '40plus': ['40', 'menopause', 'joints', 'joint', 'senior', 'over 40'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test'],
};

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

const MADDY_PHONE = '+917082478374';

async function notifyMaddy(subject, details) {
  try {
    await sendTemplate(MADDY_PHONE, 'admin_alert', {
      templateParams: [subject, details],
    });
  } catch (err) {
    console.error('Failed to notify Maddy:', err.message);
  }
}

module.exports = {
  maskPhone,
  detectMarket,
  getLanguage,
  sendTemplate,
  sendText,
  needsEscalation,
  isOptOut,
  detectProgram,
  notifyMaddy,
  MADDY_PHONE,
};

const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

async function sendTemplate(phone, templateName, params) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { ok: false, error: 'API key missing' };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    await logMessage(phone, 'out', `[template:${templateName}]`, templateName);

    return { ok: res.ok, data };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendText(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { ok: false, error: 'API key missing' };
  }

  const body = {
    apiKey,
    campaignName: 'text_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message: { type: 'text', text },
    source: 'automation'
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    await logMessage(phone, 'out', text, null);

    return { ok: res.ok, data };
  } catch (err) {
    console.error(`WhatsApp text send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  try {
    await db.from('messages').insert({
      phone,
      direction,
      body,
      template_name: templateName,
      sent_at: new Date().toISOString(),
      status: 'sent'
    });
  } catch (err) {
    console.error(`Message log failed for ${maskPhone(phone)}:`, err.message);
  }
}

async function notifyMaddy(reason, details) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  const text = `🚨 ESCALATION: ${reason}\n\n${details}`;
  await sendText(maddyPhone, text);

  const db = getSupabase();
  await db.from('escalations').insert({
    phone: details.phone || 'system',
    reason,
    message_body: details.message || text
  });
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'not eating',
  'medical condition', 'surgery'
];

function checkEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.find(kw => lower.includes(kw)) || null;
}

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'shred', 'weight', 'burn', 'lean'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', 'age'],
  '12wk': ['custom', '12 week', 'serious', 'flagship', 'full program', 'transform'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test']
};

function detectProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return program;
    }
  }
  return null;
}

module.exports = {
  sendTemplate,
  sendText,
  logMessage,
  notifyMaddy,
  maskPhone,
  detectMarket,
  isHinglish,
  checkEscalation,
  detectProgram
};

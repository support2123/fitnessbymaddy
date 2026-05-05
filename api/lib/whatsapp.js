const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

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

async function canSendMessage(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return true;
  const lastSent = new Date(data[0].sent_at).getTime();
  return Date.now() - lastSent >= RATE_LIMIT_MS;
}

async function sendTemplate(phone, templateName, params = []) {
  const response = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AiSensy-Project-API-Pwd': process.env.AISENSY_API_KEY
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      templateParams: params,
      source: 'automation'
    })
  });

  const result = await response.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `Template: ${templateName}`,
    template_name: templateName,
    status: response.ok ? 'sent' : 'failed'
  });

  return result;
}

async function sendTextMessage(phone, text) {
  const response = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AiSensy-Project-API-Pwd': process.env.AISENSY_API_KEY
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      message: text,
      source: 'automation'
    })
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: response.ok ? 'sent' : 'failed'
  });

  return response.ok;
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'medication', 'pain', 'dizzy', 'dizziness',
  'eating disorder', 'vomit', 'faint'
];

function needsEscalation(text) {
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(phone, reason, originalMsg) {
  const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';
  await sendTextMessage(
    MADDY_PHONE,
    `🚨 ESCALATION\nFrom: ${maskPhone(phone)}\nReason: ${reason}\nMsg: "${originalMsg.slice(0, 200)}"`
  );
}

module.exports = {
  maskPhone,
  detectMarket,
  canSendMessage,
  sendTemplate,
  sendTextMessage,
  needsEscalation,
  escalateToMaddy,
  RATE_LIMIT_MS
};

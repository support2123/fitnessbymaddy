const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '917082478374';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith('91') || phone.startsWith('+91')) return 'IN';
  if (phone.startsWith('971') || phone.startsWith('+971')) return 'UAE';
  if (phone.startsWith('44') || phone.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}

function normalizePhone(phone) {
  return phone.replace(/[\s\-\+\(\)]/g, '');
}

async function canSendMessage(phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);
  return !data || data.length === 0;
}

async function sendWhatsApp({ phone, body, templateName, templateParams }) {
  const isClient = await isActiveClient(phone);
  if (!isClient) {
    const allowed = await canSendMessage(phone);
    if (!allowed) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { ok: false, reason: 'rate_limited' };
    }
  }

  const payload = templateName
    ? {
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: templateName,
        destination: phone,
        userName: 'FitnessByMaddy',
        templateParams: templateParams || [],
      }
    : {
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: 'session_message',
        destination: phone,
        userName: 'FitnessByMaddy',
        message: body,
      };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await res.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: body || `[template: ${templateName}]`,
      template_name: templateName || null,
      status: res.ok ? 'sent' : 'failed',
    });

    return { ok: res.ok, result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function isActiveClient(phone) {
  const { data } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);
  return data && data.length > 0;
}

async function notifyMaddy(reason, details) {
  await sendWhatsApp({
    phone: MADDY_PHONE,
    body: `🚨 ESCALATION: ${reason}\n\n${details}`,
  });
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulimi',
  'not eating', 'medical condition',
];

function checkEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.find(kw => lower.includes(kw)) || null;
}

function checkOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe';
}

module.exports = {
  sendWhatsApp,
  notifyMaddy,
  detectMarket,
  normalizePhone,
  maskPhone,
  checkEscalation,
  checkOptOut,
  canSendMessage,
  MADDY_PHONE,
};

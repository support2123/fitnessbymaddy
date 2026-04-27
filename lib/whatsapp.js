const { getSupabase } = require('./supabase');
const { maskPhone } = require('./mask-phone');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const BUSINESS_PHONE = '+917082478374';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendTemplate(phone, templateName, params = []) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  await logMessage(phone, 'out', params.join(' | ') || templateName, templateName, res.ok ? 'sent' : 'failed');

  if (!res.ok) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, data);
  }

  return { ok: res.ok, data };
}

async function sendText(phone, text) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message: text,
    source: 'automation'
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  await logMessage(phone, 'out', text, null, res.ok ? 'sent' : 'failed');

  return { ok: res.ok, data };
}

async function canSendMessage(phone) {
  const db = getSupabase();
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);

  return !data || data.length === 0;
}

async function canSendToClient(phone) {
  const db = getSupabase();
  const { data } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  return data && data.length > 0;
}

async function rateLimitedSend(phone, templateName, params = []) {
  const isClient = await canSendToClient(phone);
  if (!isClient) {
    const allowed = await canSendMessage(phone);
    if (!allowed) {
      console.log(`Rate limited: skipping send to ${maskPhone(phone)}`);
      return { ok: false, reason: 'rate_limited' };
    }
  }
  return sendTemplate(phone, templateName, params);
}

async function logMessage(phone, direction, body, templateName, status) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body ? body.substring(0, 1000) : null,
    template_name: templateName,
    status
  });
}

async function notifyMaddy(subject, details) {
  await sendTemplate(BUSINESS_PHONE, 'escalation_alert', [subject, details]);
}

module.exports = {
  sendTemplate,
  sendText,
  canSendMessage,
  rateLimitedSend,
  logMessage,
  notifyMaddy,
  BUSINESS_PHONE
};

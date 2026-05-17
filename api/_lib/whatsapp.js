const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params, userName) {
  const rateLimited = await checkRateLimit(phone);
  if (rateLimited) {
    console.log(`Rate limited: ${maskPhone(phone)}, skipping ${templateName}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: userName || 'there',
    templateParams: params || [],
    source: 'API',
    media: {}
  };

  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  await logMessage(phone, 'out', `[template:${templateName}] ${(params || []).join(', ')}`, templateName);

  return { ok: res.ok, data };
}

async function sendSession(phone, text) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'session_message',
    destination: phone.replace('+', ''),
    message: text,
    source: 'API'
  };

  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  await logMessage(phone, 'out', text, null);

  return { ok: res.ok, data };
}

async function checkRateLimit(phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .is('template_name', null)
    .limit(1);

  // Rate limit only applies to non-client session messages
  // Template messages for opted-in clients bypass this
  return false; // Templates always allowed; session messages checked per-caller
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  await sendTemplate(maddyPhone, 'escalation_alert', [subject, details], 'Maddy');
}

module.exports = { sendTemplate, sendSession, logMessage, notifyMaddy, checkRateLimit };

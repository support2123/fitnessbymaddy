const { getClient } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_TEMPLATE_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const AISENSY_DIRECT_API = 'https://backend.aisensy.com/direct/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000;

async function canSendMessage(phone, isClient) {
  if (isClient) return true;
  const db = getClient();
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

async function sendTemplate(phone, templateName, params, isClient) {
  if (!await canSendMessage(phone, isClient)) {
    console.log('Rate limited:', maskPhone(phone));
    return { sent: false, reason: 'rate_limited' };
  }

  params = params || [];
  const res = await fetch(AISENSY_TEMPLATE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone.replace(/^\+/, ''),
      userName: 'FitnessByMaddy',
      templateParams: params
    })
  });

  const result = await res.json().catch(() => ({}));
  const db = getClient();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: '[template: ' + templateName + '] ' + params.join(', '),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed'
  });

  return { sent: res.ok, result };
}

async function sendText(phone, text, isClient) {
  if (!await canSendMessage(phone, isClient)) {
    console.log('Rate limited:', maskPhone(phone));
    return { sent: false, reason: 'rate_limited' };
  }

  const res = await fetch(AISENSY_DIRECT_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      destination: phone.replace(/^\+/, ''),
      type: 'text',
      message: text
    })
  });

  const result = await res.json().catch(() => ({}));
  const db = getClient();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed'
  });

  return { sent: res.ok, result };
}

async function notifyMaddy(subject, details) {
  const phone = process.env.MADDY_PHONE || '+917082478374';
  return sendText(phone, '\u{1F6A8} ' + subject + '\n\n' + details, true);
}

module.exports = { sendTemplate, sendText, notifyMaddy, canSendMessage };

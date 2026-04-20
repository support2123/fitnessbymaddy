const { getClient } = require('./supabase');
const { RATE_LIMIT_MS } = require('./constants');

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

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

async function sendTemplate(phone, templateName, params = {}) {
  const allowed = await canSendMessage(phone, params.isClient);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    media: params.media || {},
  };

  const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();
  await logMessage(phone, 'out', params.templateParams?.join(' | ') || templateName, templateName);
  return { ok: res.ok, result };
}

async function sendText(phone, text, isClient = false) {
  const allowed = await canSendMessage(phone, isClient);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone.replace('+', ''),
    message: text,
  };

  const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();
  await logMessage(phone, 'out', text, null);
  return { ok: res.ok, result };
}

async function logMessage(phone, direction, body, templateName) {
  const db = getClient();
  await db.from('messages').insert({
    phone,
    direction,
    body: body?.substring(0, 1000),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

module.exports = { sendTemplate, sendText, logMessage, maskPhone, canSendMessage };

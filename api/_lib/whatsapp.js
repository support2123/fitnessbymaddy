const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSend(phone, isClient) {
  if (isClient) return true;
  const db = getSupabase();
  const { data } = await db
    .from('rate_limits')
    .select('last_sent_at')
    .eq('phone', phone)
    .single();
  if (!data) return true;
  return Date.now() - new Date(data.last_sent_at).getTime() > RATE_LIMIT_MS;
}

async function recordSend(phone) {
  const db = getSupabase();
  await db
    .from('rate_limits')
    .upsert({ phone, last_sent_at: new Date().toISOString() }, { onConflict: 'phone' });
}

async function sendTemplate(phone, templateName, params) {
  const allowed = await canSend(phone, false);
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
    source: 'fitnessbymaddy-automation',
    buttons: params.buttons || []
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();
  await recordSend(phone);
  await logMessage(phone, 'out', `[template:${templateName}]`, templateName);
  return { ok: res.ok, result };
}

async function sendText(phone, text, isClient) {
  const allowed = await canSend(phone, isClient);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone.replace('+', ''),
    message: text,
    source: 'fitnessbymaddy-automation'
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();
  await recordSend(phone);
  await logMessage(phone, 'out', text, null);
  return { ok: res.ok, result };
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

module.exports = { sendTemplate, sendText, logMessage, canSend };

const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours
const MADDY_PHONE = '+917082478374';

async function canSendMessage(phone, isClient) {
  if (isClient) return true;

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

async function sendTemplate(phone, templateName, params) {
  const allowed = await canSendMessage(phone, false);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  return sendRaw(phone, templateName, params);
}

async function sendClientMessage(phone, templateName, params) {
  return sendRaw(phone, templateName, params);
}

async function sendRaw(phone, templateName, params) {
  const db = getSupabase();
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    source: 'fitnessbymaddy-automation',
    buttons: params.buttons || []
  };

  try {
    const res = await fetch(AISENSY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const result = await res.json();

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: templateName + ': ' + JSON.stringify(params.templateParams || []),
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok, data: result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function notifyMaddy(subject, details) {
  try {
    await sendRaw(MADDY_PHONE, 'escalation_alert', {
      name: 'Maddy',
      templateParams: [subject, details]
    });
  } catch (err) {
    console.error('Failed to notify Maddy:', err.message);
  }
}

async function logInbound(phone, body) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body,
    status: 'received'
  });
}

module.exports = {
  sendTemplate,
  sendClientMessage,
  sendRaw,
  notifyMaddy,
  logInbound,
  canSendMessage,
  MADDY_PHONE
};

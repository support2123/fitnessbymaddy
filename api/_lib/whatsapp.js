const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

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

async function sendTemplate(phone, templateName, params, userName) {
  const db = getSupabase();
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: userName || 'there',
    templateParams: params || []
  };

  let status = 'sent';
  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      status = 'failed';
      console.error(`WhatsApp send failed for ${maskPhone(phone)}: ${res.status}`);
    }
  } catch (err) {
    status = 'failed';
    console.error(`WhatsApp send error for ${maskPhone(phone)}: ${err.message}`);
  }

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: `Template: ${templateName} | Params: ${JSON.stringify(params || [])}`,
    template_name: templateName,
    status
  });

  return status === 'sent';
}

async function sendText(phone, text) {
  const db = getSupabase();
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone,
    userName: 'Fitness by Maddy',
    templateParams: [text]
  };

  let status = 'sent';
  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) status = 'failed';
  } catch {
    status = 'failed';
  }

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status
  });

  return status === 'sent';
}

async function notifyMaddy(subject, details) {
  const maddyPhone = '+917082478374';
  const msg = `[ESCALATION] ${subject}\n${details}`;
  await sendText(maddyPhone, msg);
}

async function logIncoming(phone, text) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: text,
    status: 'received'
  });
}

module.exports = { canSendMessage, sendTemplate, sendText, notifyMaddy, logIncoming };

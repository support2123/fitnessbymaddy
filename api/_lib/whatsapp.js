const { getSupabase } = require('./supabase');
const { maskPhone } = require('./mask-phone');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendTo(phone, isClient) {
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
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AiSensy-Project-API-Pwd': process.env.AISENSY_API_KEY,
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'Fitness by Maddy',
      templateParams: params || [],
    }),
  });
  const result = await res.json();
  return result;
}

async function sendMessage(phone, body, templateName, isClient) {
  const allowed = await canSendTo(phone, isClient);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { rateLimited: true };
  }

  const result = await sendTemplate(phone, templateName, body ? [body] : []);

  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || templateName,
    template_name: templateName,
    status: result.success === false ? 'failed' : 'sent',
  });

  return result;
}

async function logIncoming(phone, body) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body,
  });
}

module.exports = { sendMessage, sendTemplate, logIncoming, canSendTo };

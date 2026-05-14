const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params = []) {
  if (await isOptedOut(phone)) return { skipped: true, reason: 'opted_out' };
  if (await isRateLimited(phone)) return { skipped: true, reason: 'rate_limited' };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params,
    }),
  });

  const data = await res.json();

  await logMessage(phone, 'out', params.join(' | '), templateName);
  return data;
}

async function sendText(phone, text) {
  if (await isOptedOut(phone)) return { skipped: true, reason: 'opted_out' };
  if (await isRateLimited(phone)) return { skipped: true, reason: 'rate_limited' };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: text,
    }),
  });

  const data = await res.json();
  await logMessage(phone, 'out', text, null);
  return data;
}

async function isOptedOut(phone) {
  const db = getSupabase();
  const { data } = await db
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .eq('status', 'dropped')
    .limit(1);
  return data && data.length > 0;
}

async function isRateLimited(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);
  return data && data.length > 0;
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

module.exports = { sendTemplate, sendText, logMessage, maskPhone };

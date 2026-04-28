const { getSupabase } = require('./supabase');

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params, userName) {
  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: userName || 'there',
      templateParams: params || [],
    }),
  });

  const data = await res.json();

  await logMessage(phone, 'out', params ? params.join(' | ') : '', templateName);

  return data;
}

async function sendSession(phone, text) {
  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'session_message',
      destination: phone,
      userName: 'there',
      message: text,
      type: 'text',
    }),
  });

  const data = await res.json();

  await logMessage(phone, 'out', text, null);

  return data;
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: (body || '').substring(0, 2000),
    template_name: templateName,
  });
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.substring(0, 3) + 'XXX...' + phone.slice(-3);
}

module.exports = { sendTemplate, sendSession, logMessage, maskPhone };

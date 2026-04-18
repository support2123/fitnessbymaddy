const { getClient } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params = []) {
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

  await logMessage(phone, 'out', params.join(' | ') || templateName, templateName);

  return data;
}

async function sendText(phone, body) {
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
      message: body,
    }),
  });

  const data = await res.json();
  await logMessage(phone, 'out', body, null);
  return data;
}

async function logMessage(phone, direction, body, templateName) {
  const db = getClient();
  await db.from('messages').insert({
    phone: maskPhone(phone),
    direction,
    body: body?.substring(0, 500),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return phone;
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

module.exports = { sendTemplate, sendText, logMessage, maskPhone };

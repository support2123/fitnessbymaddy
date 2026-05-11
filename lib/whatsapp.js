const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, params = {}) {
  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: params.name || 'there',
      templateParams: params.templateParams || [],
      source: 'fitnessbymaddy-automation',
      media: params.media || undefined,
    }),
  });

  const result = await resp.json();

  const db = getSupabase();
  await db.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'out',
    body: params.templateParams ? params.templateParams.join(' | ') : templateName,
    template_name: templateName,
    status: resp.ok ? 'sent' : 'failed',
  });

  return result;
}

async function sendTextMessage(phone, text) {
  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: [text],
      source: 'fitnessbymaddy-automation',
    }),
  });

  const result = await resp.json();

  const db = getSupabase();
  await db.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'out',
    body: text,
    template_name: null,
    status: resp.ok ? 'sent' : 'failed',
  });

  return result;
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

module.exports = { sendWhatsApp, sendTextMessage, maskPhone };

const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, bodyParams = [], mediaUrl = null) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: bodyParams,
  };

  if (mediaUrl) {
    payload.mediaUrl = mediaUrl;
    payload.mediaFilename = 'program.pdf';
  }

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: bodyParams.join(' | '),
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return result;
}

async function sendFreeformWhatsApp(phone, message) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message,
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: message,
    template_name: null,
    status: res.ok ? 'sent' : 'failed',
  });

  return res.json();
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp };

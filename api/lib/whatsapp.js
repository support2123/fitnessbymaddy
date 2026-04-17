const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, params = []) {
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

  const db = getSupabase();
  await db.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'out',
    body: `Template: ${templateName} | Params: ${JSON.stringify(params)}`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok, data };
}

async function sendFreeformWhatsApp(phone, message) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'freeform_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: message,
    }),
  });

  const data = await res.json();

  const db = getSupabase();
  await db.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'out',
    body: message.substring(0, 500),
    template_name: null,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok, data };
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.substring(0, 3) + 'XXX...' + phone.slice(-3);
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp, maskPhone };

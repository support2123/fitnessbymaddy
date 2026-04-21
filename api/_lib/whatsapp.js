const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, body, params }) {
  const db = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;

  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const payload = {
    apiKey,
    campaignName: templateName || 'direct_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  if (body && !templateName) {
    payload.message = body;
  }

  const response = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || `template:${templateName}`,
    template_name: templateName,
    status: response.ok ? 'sent' : 'failed'
  });

  return { ok: response.ok, result };
}

async function sendTextMessage(phone, text) {
  return sendWhatsApp({ phone, body: text });
}

async function sendTemplate(phone, templateName, params) {
  return sendWhatsApp({ phone, templateName, params });
}

async function notifyMaddy(reason, details) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  const text = `🚨 ESCALATION: ${reason}\n\n${details}`;
  return sendTextMessage(maddyPhone, text);
}

module.exports = { sendWhatsApp, sendTextMessage, sendTemplate, notifyMaddy };

const { getClient } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    media: params.media || undefined
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  await logMessage(phone, 'out', `[template:${templateName}]`, templateName);

  return result;
}

async function sendText(phone, text) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone.replace('+', ''),
    message: text
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();
  await logMessage(phone, 'out', text, null);
  return result;
}

async function sendToMaddy(text) {
  const { MADDY_PHONE } = require('./escalation');
  return sendText(MADDY_PHONE, text);
}

async function logMessage(phone, direction, body, templateName) {
  const sb = getClient();
  await sb.from('messages').insert({
    phone,
    direction,
    body: body ? body.substring(0, 2000) : '',
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  }).catch(err => {
    console.error(`Message log failed for ${maskPhone(phone)}:`, err.message);
  });
}

module.exports = { sendTemplate, sendText, sendToMaddy, logMessage };

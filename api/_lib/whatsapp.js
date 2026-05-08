const { supabase } = require('./supabase');
const { canSendMessage } = require('./rate-limiter');
const { maskPhone } = require('./market');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, body, isClient = false }) {
  const allowed = await canSendMessage(phone, isClient);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { sent: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: [],
    media: {}
  };

  if (body) {
    payload.templateParams = Array.isArray(body) ? body : [body];
  }

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return { sent: res.ok, result };
}

async function sendFreeformWhatsApp({ phone, message, isClient = false }) {
  const allowed = await canSendMessage(phone, isClient);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { sent: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: message,
    template_name: 'freeform',
    status: res.ok ? 'sent' : 'failed'
  });

  return { sent: res.ok };
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp };

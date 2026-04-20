const { supabase } = require('./supabase');
const { maskPhone } = require('./pii');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '+917082478374';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendToLead(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return true;
  const lastSent = new Date(data[0].sent_at).getTime();
  return Date.now() - lastSent >= RATE_LIMIT_MS;
}

async function sendTemplate(phone, templateName, params = []) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    media: {}
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[Template: ${templateName}] ${params.join(', ')}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  if (!res.ok) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, result);
  }

  return { ok: res.ok, result };
}

async function sendText(phone, text) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message: text
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok };
}

async function notifyMaddy(alertText) {
  return sendText(MADDY_PHONE, alertText);
}

async function logIncoming(phone, body) {
  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body,
    status: 'received'
  });
}

module.exports = {
  sendTemplate,
  sendText,
  notifyMaddy,
  logIncoming,
  canSendToLead,
  MADDY_PHONE
};

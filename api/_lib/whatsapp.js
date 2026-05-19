const { supabase } = require('./supabase');
const { maskPhone } = require('./pii');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function checkRateLimit(phone, isClient) {
  if (isClient) return true;

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
  const response = await fetch(AISENSY_API, {
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
      source: 'automation',
      buttons: [],
    }),
  });

  const result = await response.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `Template: ${templateName} | Params: ${JSON.stringify(params)}`,
    template_name: templateName,
    status: response.ok ? 'sent' : 'failed',
  });

  console.log(`[WhatsApp] Sent ${templateName} to ${maskPhone(phone)}: ${response.ok ? 'OK' : 'FAIL'}`);
  return result;
}

async function sendText(phone, text) {
  const response = await fetch(AISENSY_API, {
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
      source: 'automation',
    }),
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: response.ok ? 'sent' : 'failed',
  });

  return response.json();
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  const msg = `🚨 ESCALATION: ${subject}\n\n${details}`;
  return sendText(maddyPhone, msg);
}

module.exports = { sendTemplate, sendText, notifyMaddy, checkRateLimit };

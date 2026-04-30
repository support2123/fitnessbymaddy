const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendTemplate(phone, templateName, params = []) {
  const rateLimited = await checkRateLimit(phone);
  if (rateLimited) return { ok: false, reason: 'rate_limited' };

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

  await logMessage(phone, 'out', params.join(' | '), templateName);

  return { ok: res.ok, data };
}

async function sendText(phone, message) {
  const rateLimited = await checkRateLimit(phone);
  if (rateLimited) return { ok: false, reason: 'rate_limited' };

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
      message: message,
    }),
  });

  const data = await res.json();

  await logMessage(phone, 'out', message, null);

  return { ok: res.ok, data };
}

async function checkRateLimit(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    const lastSent = new Date(data[0].sent_at).getTime();
    if (Date.now() - lastSent < RATE_LIMIT_MS) {
      return true;
    }
  }
  return false;
}

async function checkClientRateLimit(phone) {
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  return client && client.length > 0;
}

async function sendWhatsApp(phone, templateName, params = [], forceForClient = false) {
  if (forceForClient) {
    const isClient = await checkClientRateLimit(phone);
    if (isClient) {
      return sendTemplate(phone, templateName, params);
    }
  }
  return sendTemplate(phone, templateName, params);
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

module.exports = { sendTemplate, sendText, sendWhatsApp, logMessage, checkRateLimit };

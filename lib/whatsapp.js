const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
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
  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.AISENSY_API_KEY}`,
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params,
    }),
  });
  const result = await res.json();
  return result;
}

async function sendText(phone, message) {
  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.AISENSY_API_KEY}`,
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'direct_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: message,
    }),
  });
  const result = await res.json();
  return result;
}

async function sendMessage(phone, { template, params, text, isClient = false }) {
  const allowed = await checkRateLimit(phone, isClient);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  let result;
  const body = text || `[template:${template}]`;

  if (template) {
    result = await sendTemplate(phone, template, params || []);
  } else if (text) {
    result = await sendText(phone, text);
  } else {
    return { ok: false, reason: 'no_content' };
  }

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body,
    template_name: template || null,
    status: 'sent',
  });

  return { ok: true, result };
}

async function logIncoming(phone, body) {
  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body,
    status: 'received',
  });
}

module.exports = { sendMessage, logIncoming, checkRateLimit };

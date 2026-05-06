const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

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
    if (Date.now() - lastSent < RATE_LIMIT_MS) return false;
  }
  return true;
}

async function sendTemplate(phone, templateName, params, skipRateLimit) {
  if (!skipRateLimit) {
    const allowed = await checkRateLimit(phone);
    if (!allowed) return { sent: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'automation'
  };

  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await resp.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[template: ${templateName}]`,
    template_name: templateName,
    status: resp.ok ? 'sent' : 'failed'
  });

  return { sent: resp.ok, result };
}

async function sendText(phone, text, skipRateLimit) {
  if (!skipRateLimit) {
    const allowed = await checkRateLimit(phone);
    if (!allowed) return { sent: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message: { type: 'text', text },
    source: 'automation'
  };

  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: resp.ok ? 'sent' : 'failed'
  });

  return { sent: resp.ok };
}

async function notifyMaddy(subject, details) {
  const maddyPhone = '+917082478374';
  const text = `🚨 ESCALATION: ${subject}\n\n${details}`;
  return sendText(maddyPhone, text, true);
}

async function logInbound(phone, body) {
  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body,
    status: 'received'
  });
}

module.exports = { sendTemplate, sendText, notifyMaddy, logInbound, checkRateLimit };

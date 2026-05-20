const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_API_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendTemplate(phone, templateName, params = []) {
  const rateLimited = await isRateLimited(phone);
  if (rateLimited) {
    console.log(`Rate limited: ${maskPhone(phone)}, template: ${templateName}`);
    return { sent: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/[^0-9]/g, ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
  };

  const res = await fetch(AISENSY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  await logMessage(phone, 'out', params.join(' | ') || templateName, templateName);

  return { sent: res.ok, result };
}

async function sendSessionMessage(phone, message) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'session_message',
    destination: phone.replace(/[^0-9]/g, ''),
    userName: 'FitnessByMaddy',
    message,
  };

  const res = await fetch('https://backend.aisensy.com/direct/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  await logMessage(phone, 'out', message, null);

  return { sent: res.ok, result };
}

async function isRateLimited(phone) {
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);

  return data && data.length > 0;
}

async function isClientPhone(phone) {
  const { data } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  return data && data.length > 0;
}

async function sendToClient(phone, templateName, params = []) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/[^0-9]/g, ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
  };

  const res = await fetch(AISENSY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  await logMessage(phone, 'out', params.join(' | ') || templateName, templateName);

  return { sent: res.ok, result };
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body: body ? body.slice(0, 1000) : null,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

async function notifyMaddy(reason, context) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  const msg = `🚨 ESCALATION\nReason: ${reason}\nContext: ${context}`;
  return sendToClient(maddyPhone, 'escalation_alert', [reason, context]);
}

module.exports = {
  sendTemplate,
  sendSessionMessage,
  sendToClient,
  isRateLimited,
  isClientPhone,
  logMessage,
  notifyMaddy,
};

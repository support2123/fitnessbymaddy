const supabase = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_BASE = 'https://backend.aisensy.com';

async function sendTemplate(phone, templateName, params = []) {
  const rateOk = await checkRateLimit(phone);
  if (!rateOk) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const res = await fetch(`${AISENSY_BASE}/campaign/t1/api/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params
    })
  });

  const data = await res.json();

  await logMessage(phone, 'out', `[template: ${templateName}]`, templateName);

  return { ok: res.ok, data };
}

async function sendText(phone, message) {
  const rateOk = await checkRateLimit(phone);
  if (!rateOk) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const res = await fetch(`${AISENSY_BASE}/direct/t1/api/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      destination: phone,
      message,
      userName: 'FitnessByMaddy'
    })
  });

  const data = await res.json();
  await logMessage(phone, 'out', message, null);

  return { ok: res.ok, data };
}

async function sendMediaMessage(phone, mediaUrl, caption) {
  const res = await fetch(`${AISENSY_BASE}/direct/t1/api/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      destination: phone,
      type: 'document',
      mediaUrl,
      caption,
      userName: 'FitnessByMaddy'
    })
  });

  const data = await res.json();
  await logMessage(phone, 'out', `[PDF: ${caption}]`, null);

  return { ok: res.ok, data };
}

async function checkRateLimit(phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  // Clients (opted-in) bypass rate limit — checked by caller
  return !data || data.length === 0;
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
    sent_at: new Date().toISOString()
  });
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  await sendText(maddyPhone, `🚨 ESCALATION: ${subject}\n\n${details}`);
}

module.exports = {
  sendTemplate, sendText, sendMediaMessage,
  logMessage, notifyMaddy, checkRateLimit
};

const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendTemplate(phone, templateName, params, isClient) {
  if (!isClient) {
    const allowed = await checkRateLimit(phone);
    if (!allowed) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { sent: false, reason: 'rate_limited' };
    }
  }

  const apiKey = process.env.AISENSY_API_KEY;
  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params || []
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();
  const sent = res.ok;

  await logMessage(phone, 'out', params?.[0] || templateName, templateName, sent ? 'sent' : 'failed');

  return { sent, result };
}

async function sendText(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  const body = {
    apiKey,
    campaignName: 'text_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    message: { text }
  };

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  await logMessage(phone, 'out', text, 'text_message', res.ok ? 'sent' : 'failed');
  return res.ok;
}

async function checkRateLimit(phone) {
  const db = getSupabase();
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);
  return !data || data.length === 0;
}

async function logMessage(phone, direction, body, templateName, status) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body?.substring(0, 500),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status
  });
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  const text = `🚨 ESCALATION: ${subject}\n\n${details}`;
  await sendText(maddyPhone, text);
}

module.exports = { sendTemplate, sendText, logMessage, notifyMaddy, checkRateLimit };

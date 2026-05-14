const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendTemplate(phone, templateName, params, isClient) {
  if (!isClient) {
    const canSend = await checkRateLimit(phone);
    if (!canSend) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { ok: false, reason: 'rate_limited' };
    }
  }

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone.replace('+', ''),
      userName: params.name || 'there',
      templateParams: params.templateParams || [],
      media: params.media || undefined
    })
  });

  const result = await res.json();

  await logMessage(phone, 'out', params.templateParams?.[0] || templateName, templateName);

  return { ok: res.ok, result };
}

async function sendText(phone, text, isClient) {
  if (!isClient) {
    const canSend = await checkRateLimit(phone);
    if (!canSend) return { ok: false, reason: 'rate_limited' };
  }

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone.replace('+', ''),
      message: text
    })
  });

  await logMessage(phone, 'out', text, null);

  return { ok: res.ok };
}

async function checkRateLimit(phone) {
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);

  return !data || data.length === 0;
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body: body?.substring(0, 1000),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

async function notifyMaddy(subject, details) {
  const maddy = process.env.MADDY_PHONE || '+917082478374';
  await sendText(maddy, `ESCALATION: ${subject}\n\n${details}`, true);
}

module.exports = { sendTemplate, sendText, logMessage, notifyMaddy, checkRateLimit };

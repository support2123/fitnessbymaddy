const { getSupabase } = require('./supabase');
const { maskPhone } = require('./phone');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '917082478374';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendTemplate(phone, templateName, params, mediaUrl) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'api-automation'
  };
  if (mediaUrl) {
    payload.media = { url: mediaUrl, filename: 'program.pdf' };
  }

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  await logMessage(phone, 'out', `[template:${templateName}] ${(params || []).join(', ')}`, templateName);
  return data;
}

async function sendText(phone, text) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: { type: 'text', text },
    source: 'api-automation'
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  await logMessage(phone, 'out', text, null);
  return data;
}

async function checkRateLimit(phone) {
  const supabase = getSupabase();
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

async function sendRateLimited(phone, templateName, params, mediaUrl) {
  const limited = await checkRateLimit(phone);
  if (limited) {
    console.log(`Rate limited: skipping message to ${maskPhone(phone)}`);
    return { skipped: true, reason: 'rate_limited' };
  }
  return sendTemplate(phone, templateName, params, mediaUrl);
}

async function notifyMaddy(subject, details) {
  return sendText(MADDY_PHONE, `ESCALATION: ${subject}\n${details}`);
}

async function logMessage(phone, direction, body, templateName) {
  const supabase = getSupabase();
  await supabase.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

module.exports = {
  sendTemplate,
  sendText,
  sendRateLimited,
  checkRateLimit,
  notifyMaddy,
  logMessage
};

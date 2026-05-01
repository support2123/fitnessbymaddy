const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendTemplate(phone, templateName, params = []) {
  const canSend = await checkRateLimit(phone);
  if (!canSend) return { ok: false, reason: 'rate_limited' };

  const resp = await fetch(AISENSY_BASE, {
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

  const data = await resp.json();
  await logMessage(phone, 'out', `[template:${templateName}] ${params.join(', ')}`, templateName);
  return { ok: resp.ok, data };
}

async function sendFreeform(phone, message) {
  const canSend = await checkRateLimit(phone);
  if (!canSend) return { ok: false, reason: 'rate_limited' };

  const resp = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'freeform_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: message,
    }),
  });

  const data = await resp.json();
  await logMessage(phone, 'out', message, null);
  return { ok: resp.ok, data };
}

async function sendMediaTemplate(phone, templateName, params = [], mediaUrl) {
  const canSend = await checkRateLimit(phone);
  if (!canSend) return { ok: false, reason: 'rate_limited' };

  const resp = await fetch(AISENSY_BASE, {
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
      mediaUrl: mediaUrl,
      mediaFilename: 'program.pdf',
    }),
  });

  const data = await resp.json();
  await logMessage(phone, 'out', `[media:${templateName}] ${mediaUrl}`, templateName);
  return { ok: resp.ok, data };
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

  // Active clients are exempt from rate limiting
  const { data: activeClient } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  if (activeClient && activeClient.length > 0) return true;
  return !data || data.length === 0;
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

module.exports = { sendTemplate, sendFreeform, sendMediaTemplate, logMessage, maskPhone };

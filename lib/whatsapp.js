const { getClient } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, bodyValues, mediaUrl }) {
  const rateLimitOk = await checkRateLimit(phone);
  if (!rateLimitOk) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: bodyValues || [],
  };
  if (mediaUrl) {
    payload.mediaUrl = mediaUrl;
    payload.mediaFilename = 'program.pdf';
  }

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  const ok = res.ok;

  await logMessage({
    phone,
    direction: 'out',
    body: bodyValues ? bodyValues.join(' | ') : templateName,
    template_name: templateName,
    status: ok ? 'sent' : 'failed',
  });

  return { ok, result };
}

async function sendFreeformWhatsApp({ phone, message }) {
  const rateLimitOk = await checkRateLimit(phone);
  if (!rateLimitOk) {
    return { ok: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_reply',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    message,
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  await logMessage({
    phone,
    direction: 'out',
    body: message,
    template_name: 'freeform_reply',
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok };
}

async function checkRateLimit(phone) {
  const db = getClient();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  const { data: clientData } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  if (clientData && clientData.length > 0) return true;
  return !data || data.length === 0;
}

async function logMessage({ phone, direction, body, template_name, status }) {
  const db = getClient();
  await db.from('messages').insert({
    phone,
    direction,
    body: body ? body.substring(0, 1000) : null,
    template_name,
    status,
  });
}

async function notifyMaddy(reason, details) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  await sendWhatsApp({
    phone: maddyPhone,
    templateName: 'escalation_alert',
    bodyValues: [reason, details.substring(0, 200)],
  });
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp, logMessage, notifyMaddy };

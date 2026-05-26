const { getSupabase } = require('./supabase');
const { maskPhone } = require('./utils');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, bodyValues = [], mediaUrl) {
  const rateLimitOk = await checkRateLimit(phone);
  if (!rateLimitOk) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: bodyValues,
  };

  if (mediaUrl) {
    payload.mediaUrl = mediaUrl;
    payload.mediaFilename = 'program.pdf';
  }

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  const ok = res.ok;

  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: bodyValues.join(' | '),
    template_name: templateName,
    status: ok ? 'sent' : 'failed',
  });

  if (!ok) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, data);
  }

  return { ok, data };
}

async function sendFreeformWhatsApp(phone, message) {
  const rateLimitOk = await checkRateLimit(phone);
  if (!rateLimitOk) return { ok: false, reason: 'rate_limited' };

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: { text: message },
  };

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: message,
    template_name: 'freeform',
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok };
}

async function checkRateLimit(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();

  if (client) return true;
  return !data || data.length === 0;
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp };

const { getSupabase } = require('./supabase');
const { maskPhone } = require('./mask-phone');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, message, templateName) {
  const allowed = await checkRateLimit(phone);
  if (!allowed) {
    console.log(`Rate limited for ${maskPhone(phone)}, skipping`);
    return { ok: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName || 'direct_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message
  };

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();

  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: typeof message === 'string' ? message : JSON.stringify(message),
    template_name: templateName || null,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok, data };
}

async function sendTemplate(phone, templateName, params) {
  const allowed = await checkRateLimit(phone);
  if (!allowed) {
    console.log(`Rate limited for ${maskPhone(phone)}, skipping`);
    return { ok: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params || []
  };

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();

  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: JSON.stringify(params),
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok, data };
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

  const isClient = await isOptedInClient(phone);
  if (isClient) return true;

  return !data || data.length === 0;
}

async function isOptedInClient(phone) {
  const db = getSupabase();
  const { data } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  return data && data.length > 0;
}

module.exports = { sendWhatsApp, sendTemplate, checkRateLimit };

const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, params = []) {
  const allowed = await checkRateLimit(phone);
  if (!allowed) return { ok: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();

  await logMessage(phone, 'out', params.join(' | '), templateName);

  return { ok: res.ok, result };
}

async function sendFreeformWhatsApp(phone, message) {
  const allowed = await checkRateLimit(phone);
  if (!allowed) return { ok: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message,
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  await logMessage(phone, 'out', message, 'freeform');

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

  const { data: clientData } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  if (clientData && clientData.length > 0) return true;

  return !data || data.length === 0;
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body ? body.substring(0, 500) : '',
    template_name: templateName || null,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.substring(0, 3) + 'XXX...' + phone.substring(phone.length - 3);
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp, logMessage, maskPhone };

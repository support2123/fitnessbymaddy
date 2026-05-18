const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, bodyParams = [], mediaUrl) {
  const rateOk = await checkRateLimit(phone);
  if (!rateOk) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: bodyParams,
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
  const status = res.ok ? 'sent' : 'failed';

  await logMessage(phone, 'out', bodyParams.join(' | ') || templateName, templateName, status);

  return { ok: res.ok, data, status };
}

async function sendFreeformWhatsApp(phone, message) {
  const rateOk = await checkRateLimit(phone);
  if (!rateOk) return { ok: false, reason: 'rate_limited' };

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message,
  };

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  await logMessage(phone, 'out', message, null, res.ok ? 'sent' : 'failed');

  return { ok: res.ok };
}

async function checkRateLimit(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { count } = await db
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return (count || 0) < 1;
}

async function logMessage(phone, direction, body, templateName, status) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body ? body.substring(0, 2000) : null,
    template_name: templateName,
    status,
  });
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.substring(0, 4) + 'XXX...' + phone.slice(-3);
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp, logMessage, maskPhone, checkRateLimit };

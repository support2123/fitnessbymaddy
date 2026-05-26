const { getSupabase } = require('./supabase');
const { RATE_LIMIT_MS } = require('./constants');
const { maskPhone } = require('./market');

async function sendWhatsApp(phone, body, templateName) {
  const db = getSupabase();

  const canSend = await checkRateLimit(db, phone);
  if (!canSend) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { sent: false, reason: 'rate_limited' };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  const payload = templateName
    ? { apiKey, campaignName: templateName, destination: phone, userName: 'FitnessByMaddy', message: body }
    : { apiKey, destination: phone, message: body };

  const endpoint = templateName
    ? 'https://backend.aisensy.com/campaign/t1/api/v2'
    : 'https://backend.aisensy.com/campaign/t1/api/v2';

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || templateName,
    template_name: templateName || null,
    status: res.ok ? 'sent' : 'failed',
  });

  return { sent: res.ok, result };
}

async function checkRateLimit(db, phone) {
  const { data } = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return true;

  const lastSent = new Date(data[0].sent_at).getTime();
  return Date.now() - lastSent > RATE_LIMIT_MS;
}

async function sendWhatsAppForced(phone, body, templateName) {
  const db = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;

  const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: templateName || undefined,
      destination: phone,
      userName: 'FitnessByMaddy',
      message: body,
    }),
  });

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || templateName,
    template_name: templateName || null,
    status: res.ok ? 'sent' : 'failed',
  });

  return res.ok;
}

module.exports = { sendWhatsApp, sendWhatsAppForced, checkRateLimit };

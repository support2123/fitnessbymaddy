const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, bodyValues, mediaUrl }) {
  const db = getSupabase();

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  const isClient = client && client.length > 0;
  if (!isClient && recent && recent.length > 0) {
    return { skipped: true, reason: 'rate_limited' };
  }

  const { data: optOut } = await db
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .eq('status', 'dropped')
    .limit(1);

  if (optOut && optOut.length > 0) {
    return { skipped: true, reason: 'opted_out' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: bodyValues || [],
  };

  if (mediaUrl) {
    payload.mediaUrl = mediaUrl;
    payload.mediaFilename = 'program.pdf';
  }

  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await resp.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: templateName + (bodyValues ? ': ' + bodyValues.join(', ') : ''),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: resp.ok ? 'sent' : 'failed',
  });

  return { sent: resp.ok, result };
}

async function sendFreeformWhatsApp({ phone, message }) {
  const db = getSupabase();

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message,
  };

  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: message.slice(0, 500),
    template_name: null,
    sent_at: new Date().toISOString(),
    status: resp.ok ? 'sent' : 'failed',
  });

  return { sent: resp.ok };
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp };

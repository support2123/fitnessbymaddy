const { getSupabase } = require('./supabase');

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, bodyValues, mediaUrl) {
  const db = getSupabase();

  const rateLimited = await checkRateLimit(db, phone);
  if (rateLimited) {
    console.log(`Rate limited: ${phone.slice(0, 3)}XXX...${phone.slice(-3)}`);
    return { sent: false, reason: 'rate_limited' };
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

  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: bodyValues ? bodyValues.join(' | ') : templateName,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return { sent: res.ok, result };
}

async function sendFreeformWhatsApp(phone, message) {
  const db = getSupabase();

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message,
  };

  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: message,
    template_name: 'freeform',
    status: res.ok ? 'sent' : 'failed',
  });

  return { sent: res.ok };
}

async function checkRateLimit(db, phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return count > 0;
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp };

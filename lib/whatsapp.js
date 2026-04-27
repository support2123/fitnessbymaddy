const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, bodyParams, mediaUrl) {
  const rateLimited = await checkRateLimit(phone);
  if (rateLimited) {
    console.log(`Rate limited: ${phone.slice(0, 4)}XXX...${phone.slice(-3)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: bodyParams || [],
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

  await logMessage(phone, 'out', bodyParams ? bodyParams.join(' | ') : templateName, templateName);

  return { ok: resp.ok, data: result };
}

async function checkRateLimit(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return data && data.length > 0;
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body || '',
    template_name: templateName || null,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

module.exports = { sendWhatsApp, logMessage, checkRateLimit };

const { getSupabase, maskPhone } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, bodyValues, mediaUrl) {
  const rateLimited = await checkRateLimit(phone);
  if (rateLimited) {
    console.log(`Rate limited: skipping message to ${maskPhone(phone)}`);
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
  const data = await res.json();

  await logMessage(phone, 'out', bodyValues ? bodyValues.join(' | ') : templateName, templateName);

  return { ok: res.ok, data };
}

async function checkRateLimit(phone) {
  const sb = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await sb
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return data && data.length > 0;
}

async function logMessage(phone, direction, body, templateName) {
  const sb = getSupabase();
  await sb.from('messages').insert({
    phone,
    direction,
    body: body || '',
    template_name: templateName || null,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

module.exports = { sendWhatsApp, logMessage, checkRateLimit };

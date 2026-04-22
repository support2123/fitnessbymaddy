const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, bodyValues, mediaUrl }) {
  const rateLimitOk = await checkRateLimit(phone);
  if (!rateLimitOk) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
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

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    await logMessage({
      phone,
      direction: 'out',
      body: bodyValues ? bodyValues.join(' | ') : templateName,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed',
    });

    return { sent: res.ok, data };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { sent: false, reason: err.message };
  }
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

  return !data || data.length === 0;
}

async function logMessage({ phone, direction, body, template_name, status }) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body,
    template_name,
    status,
    sent_at: new Date().toISOString(),
  });
}

module.exports = { sendWhatsApp, logMessage, checkRateLimit };

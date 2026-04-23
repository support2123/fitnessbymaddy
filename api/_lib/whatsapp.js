const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, bodyValues, mediaUrl }) {
  const rateLimitOk = await checkRateLimit(phone);
  if (!rateLimitOk) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
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
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    const ok = res.ok;

    await logMessage({
      phone,
      direction: 'out',
      body: bodyValues ? bodyValues.join(' | ') : templateName,
      template_name: templateName,
      status: ok ? 'sent' : 'failed',
    });

    return { ok, data };
  } catch (err) {
    console.error(`WhatsApp send error for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function sendFreeformWhatsApp({ phone, message }) {
  const rateLimitOk = await checkRateLimit(phone);
  if (!rateLimitOk) return { ok: false, reason: 'rate_limited' };

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_reply',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message,
  };

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    await logMessage({
      phone,
      direction: 'out',
      body: message,
      status: res.ok ? 'sent' : 'failed',
    });

    return { ok: res.ok };
  } catch (err) {
    console.error(`WhatsApp freeform error for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function checkRateLimit(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();

  if (client) return true;

  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return (count || 0) < 1;
}

async function logMessage({ phone, direction, body, template_name, status }) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body ? body.substring(0, 1000) : null,
    template_name: template_name || null,
    status: status || 'sent',
  });
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp, logMessage };

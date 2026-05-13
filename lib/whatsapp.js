const { getSupabase } = require('./supabase');
const { maskPhone } = require('./utils');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, bodyValues, mediaUrl }) {
  const db = getSupabase();

  const rateLimited = await checkRateLimit(db, phone);
  if (rateLimited) {
    console.log(`Rate limited for ${maskPhone(phone)}, skipping`);
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

    const result = await res.json();

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: templateName + (bodyValues ? ` | ${bodyValues.join(', ')}` : ''),
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed',
    });

    return { ok: res.ok, data: result };
  } catch (err) {
    console.error(`WhatsApp send error for ${maskPhone(phone)}:`, err.message);
    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: templateName,
      template_name: templateName,
      status: 'error',
    });
    return { ok: false, reason: err.message };
  }
}

async function sendFreeformWhatsApp({ phone, message }) {
  const db = getSupabase();

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'session_message',
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

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: message,
      status: res.ok ? 'sent' : 'failed',
    });

    return { ok: res.ok };
  } catch (err) {
    console.error(`Freeform send error for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function checkRateLimit(db, phone) {
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

async function checkClientRateLimit(db, phone) {
  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  return client && client.length > 0;
}

async function sendWhatsAppToClient({ phone, templateName, bodyValues, mediaUrl }) {
  return sendWhatsApp({ phone, templateName, bodyValues, mediaUrl });
}

module.exports = {
  sendWhatsApp,
  sendFreeformWhatsApp,
  sendWhatsAppToClient,
  checkRateLimit,
  checkClientRateLimit,
};

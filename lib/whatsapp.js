const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params = []) {
  const rateLimited = await checkRateLimit(phone);
  if (rateLimited) return { ok: false, reason: 'rate_limited' };

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params,
    }),
  });

  const data = await res.json();
  await logMessage(phone, 'out', `[template: ${templateName}]`, templateName);
  return { ok: res.ok, data };
}

async function sendText(phone, message) {
  const rateLimited = await checkRateLimit(phone);
  if (rateLimited) return { ok: false, reason: 'rate_limited' };

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: message,
    }),
  });

  const data = await res.json();
  await logMessage(phone, 'out', message, null);
  return { ok: res.ok, data };
}

async function sendMedia(phone, mediaUrl, caption) {
  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'media_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      media: { url: mediaUrl, filename: 'program.pdf' },
      templateParams: [caption],
    }),
  });

  const data = await res.json();
  await logMessage(phone, 'out', `[media: ${caption}]`, 'media_message');
  return { ok: res.ok, data };
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

  if (data && data.length > 0) {
    const { data: clientData } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    if (!clientData || clientData.length === 0) return true;
  }
  return false;
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

module.exports = { sendTemplate, sendText, sendMedia, logMessage };

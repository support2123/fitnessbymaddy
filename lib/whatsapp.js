const { supabase } = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params, userName) {
  const canSend = await checkRateLimit(phone);
  if (!canSend) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: userName || 'there',
    templateParams: params || []
  };

  try {
    const resp = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();

    await logMessage(phone, 'out', `[template: ${templateName}]`, templateName);

    return { ok: resp.ok, data };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function sendText(phone, text) {
  const canSend = await checkRateLimit(phone);
  if (!canSend) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone,
    userName: 'there',
    message: text
  };

  try {
    const resp = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();

    await logMessage(phone, 'out', text, null);

    return { ok: resp.ok, data };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function sendMedia(phone, mediaUrl, caption) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'media_message',
    destination: phone,
    userName: 'there',
    mediaUrl: mediaUrl,
    mediaFilename: 'program.pdf',
    bodyValues: caption ? [caption] : []
  };

  try {
    const resp = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    await logMessage(phone, 'out', `[media: ${mediaUrl}] ${caption || ''}`, null);
    return { ok: resp.ok, data };
  } catch (err) {
    console.error(`WhatsApp media send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function checkRateLimit(phone) {
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();

  if (client) return true;

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return !recent || recent.length === 0;
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body: body ? body.slice(0, 2000) : null,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

module.exports = { sendTemplate, sendText, sendMedia, logMessage };

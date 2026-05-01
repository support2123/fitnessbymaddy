const { getSupabase } = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSend(phone, isClient) {
  if (isClient) return true;

  const db = getSupabase();
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);

  return !data || data.length === 0;
}

async function sendTemplate(phone, templateName, params) {
  const allowed = await canSend(phone, false);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'automation',
    buttons: []
  };

  try {
    const resp = await fetch(AISENSY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await resp.json();

    await logMessage(phone, 'out', `[template:${templateName}] ${(params || []).join(', ')}`, templateName);

    return { ok: resp.ok, result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function sendText(phone, text) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'session_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    message: { text },
    source: 'automation'
  };

  try {
    const resp = await fetch(AISENSY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    await logMessage(phone, 'out', text, null);

    return { ok: resp.ok };
  } catch (err) {
    console.error(`WhatsApp text failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body ? body.slice(0, 2000) : null,
    template_name: templateName,
    sent_at: new Date().toISOString()
  });
}

async function notifyMaddy(subject, details) {
  const maddy = process.env.MADDY_PHONE || '+917082478374';
  await sendText(maddy, `🚨 ESCALATION: ${subject}\n\n${details}`);
}

module.exports = { sendTemplate, sendText, logMessage, canSend, notifyMaddy };

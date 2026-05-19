const { getClient } = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '+917082478374';

async function sendTemplate(phone, templateName, params = []) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('[WA] AISENSY_API_KEY not set');
    return { ok: false, error: 'API key missing' };
  }

  const rateLimited = await checkRateLimit(phone);
  if (rateLimited) {
    console.log(`[WA] Rate limited: ${maskPhone(phone)}`);
    return { ok: false, error: 'rate_limited' };
  }

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        campaignName: templateName,
        destination: phone.replace('+', ''),
        userName: params[0] || 'there',
        templateParams: params
      })
    });

    const data = await res.json();
    await logMessage(phone, 'out', `[template:${templateName}]`, templateName);
    return { ok: res.ok, data };
  } catch (err) {
    console.error(`[WA] Send failed to ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendText(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('[WA] AISENSY_API_KEY not set');
    return { ok: false, error: 'API key missing' };
  }

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        campaignName: 'session_message',
        destination: phone.replace('+', ''),
        message: text,
        type: 'text'
      })
    });

    const data = await res.json();
    await logMessage(phone, 'out', text, null);
    return { ok: res.ok, data };
  } catch (err) {
    console.error(`[WA] Text send failed to ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function notifyMaddy(subject, details) {
  const msg = `🚨 ESCALATION: ${subject}\n\n${details}`;
  return sendText(MADDY_PHONE, msg);
}

async function checkRateLimit(phone) {
  const db = getClient();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  const { data: clientData } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  if (clientData && clientData.length > 0) return false;
  return data && data.length >= 1;
}

async function logMessage(phone, direction, body, templateName) {
  const db = getClient();
  await db.from('messages').insert({
    phone,
    direction,
    body: body ? body.substring(0, 2000) : null,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

module.exports = {
  sendTemplate,
  sendText,
  notifyMaddy,
  logMessage,
  MADDY_PHONE
};

const { getSupabase } = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params = []) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('[WA] AISENSY_API_KEY not set');
    return { ok: false, error: 'API key missing' };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    await logMessage(phone, 'out', `[template:${templateName}] ${params.join(', ')}`, templateName);

    if (!res.ok) {
      console.error(`[WA] Send failed to ${maskPhone(phone)}:`, data);
      return { ok: false, error: data };
    }

    return { ok: true, data };
  } catch (err) {
    console.error(`[WA] Network error sending to ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendFreeform(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { ok: false, error: 'API key missing' };

  const body = {
    apiKey,
    campaignName: 'freeform_reply',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: text,
    source: 'automation'
  };

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    await logMessage(phone, 'out', text, null);
    return { ok: res.ok };
  } catch (err) {
    console.error(`[WA] Freeform error to ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendToMaddy(text) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  return sendFreeform(maddyPhone, `[ESCALATION] ${text}`);
}

async function logMessage(phone, direction, body, templateName) {
  try {
    const db = getSupabase();
    await db.from('messages').insert({
      phone,
      direction,
      body: body?.slice(0, 2000),
      template_name: templateName,
      sent_at: new Date().toISOString(),
      status: 'sent'
    });
  } catch (err) {
    console.error('[WA] Failed to log message:', err.message);
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

  return data && data.length > 0;
}

module.exports = {
  sendTemplate,
  sendFreeform,
  sendToMaddy,
  logMessage,
  checkRateLimit
};

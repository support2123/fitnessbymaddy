const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendMessage(phone, isClient) {
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
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const resp = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: templateName,
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      templateParams: params || [],
      source: 'automation',
      buttons: [],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`WhatsApp send failed for ${maskPhone(phone)}: ${errText}`);
    throw new Error(`AiSensy API error: ${resp.status}`);
  }

  return resp.json();
}

async function sendTextMessage(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const resp = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: 'text_message',
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      message: { text },
      source: 'automation',
    }),
  });

  return resp.json();
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body || templateName,
    template_name: templateName,
    status: 'sent',
  });
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  const text = `[ESCALATION] ${subject}\n${details}`;
  try {
    await sendTextMessage(maddyPhone, text);
    await logMessage(maddyPhone, 'out', text, 'escalation_notify');
  } catch (err) {
    console.error('Failed to notify Maddy:', err.message);
  }
}

module.exports = { canSendMessage, sendTemplate, sendTextMessage, logMessage, notifyMaddy };

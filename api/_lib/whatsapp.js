const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
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
  const allowed = await canSendMessage(phone, false);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { sent: false, reason: 'rate_limited' };
  }
  return sendTemplateForced(phone, templateName, params);
}

async function sendTemplateForced(phone, templateName, params) {
  const db = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'automation',
    buttons: []
  };

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    const status = res.ok ? 'sent' : 'failed';

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: `[template:${templateName}] ${(params || []).join(', ')}`,
      template_name: templateName,
      status
    });

    return { sent: res.ok, result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: `[template:${templateName}] FAILED: ${err.message}`,
      template_name: templateName,
      status: 'failed'
    });
    return { sent: false, error: err.message };
  }
}

async function sendText(phone, text, isClient) {
  const allowed = await canSendMessage(phone, isClient);
  if (!allowed) return { sent: false, reason: 'rate_limited' };

  const db = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        campaignName: 'text_message',
        destination: phone.replace(/^\+/, ''),
        userName: 'FitnessByMaddy',
        message: { type: 'text', text },
        source: 'automation'
      })
    });

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: text,
      status: res.ok ? 'sent' : 'failed'
    });

    return { sent: res.ok };
  } catch (err) {
    console.error(`Text send failed for ${maskPhone(phone)}:`, err.message);
    return { sent: false, error: err.message };
  }
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  const msg = `🚨 ESCALATION: ${subject}\n\n${details}`;
  return sendTemplateForced(maddyPhone, 'escalation_alert', [subject, details]);
}

module.exports = { sendTemplate, sendTemplateForced, sendText, notifyMaddy, canSendMessage };

const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendMessage(phone, isClient) {
  if (isClient) return true;
  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data } = await supabase
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
    return { ok: false, reason: 'rate_limited' };
  }
  return sendTemplateForced(phone, templateName, params);
}

async function sendTemplateForced(phone, templateName, params) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { ok: false, reason: 'no_api_key' };
  }

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    media: params.media || {}
  };

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    await logMessage(phone, 'out', params.templateParams?.join(' | ') || templateName, templateName);

    return { ok: res.ok, data: result };
  } catch (err) {
    console.error('WhatsApp send error:', err.message);
    return { ok: false, reason: err.message };
  }
}

async function sendTextMessage(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { ok: false, reason: 'no_api_key' };

  const payload = {
    apiKey,
    campaignName: 'text_message',
    destination: phone.replace(/^\+/, ''),
    message: text
  };

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    await logMessage(phone, 'out', text, null);
    return { ok: res.ok, data: result };
  } catch (err) {
    console.error('WhatsApp text send error:', err.message);
    return { ok: false, reason: err.message };
  }
}

async function logMessage(phone, direction, body, templateName) {
  const supabase = getSupabase();
  await supabase.from('messages').insert({
    phone,
    direction,
    body: body?.substring(0, 2000),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  const msg = `ESCALATION: ${subject}\n${details}`;
  return sendTemplateForced(maddyPhone, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [subject, details.substring(0, 500)]
  });
}

module.exports = {
  canSendMessage,
  sendTemplate,
  sendTemplateForced,
  sendTextMessage,
  logMessage,
  notifyMaddy,
  RATE_LIMIT_MS
};

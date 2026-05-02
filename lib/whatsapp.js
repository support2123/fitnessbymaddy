const supabase = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSend(phone, isClient) {
  if (isClient) return true;
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

async function sendTemplate(phone, templateName, params, userName) {
  const allowed = await canSend(phone, false);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }
  return sendDirect(phone, templateName, params, userName);
}

async function sendDirect(phone, templateName, params, userName) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/[^0-9]/g, ''),
    userName: userName || 'there',
    templateParams: params || [],
    source: 'API',
  };

  try {
    const res = await fetch(AISENSY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await res.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: `Template: ${templateName} | Params: ${JSON.stringify(params)}`,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed',
    });

    return { ok: res.ok, result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function sendClientMessage(phone, templateName, params, userName) {
  return sendDirect(phone, templateName, params, userName);
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  return sendDirect(maddyPhone, 'escalation_alert', [subject, details], 'Maddy');
}

module.exports = { sendTemplate, sendClientMessage, notifyMaddy, canSend };

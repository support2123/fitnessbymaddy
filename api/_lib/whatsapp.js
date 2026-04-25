const { getSupabase } = require('./supabase');
const { maskPhone } = require('./mask-phone');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '+917082478374';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendToLead(phone) {
  const sb = getSupabase();
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data } = await sb
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
  if (!apiKey) {
    console.error(`[WA] No AISENSY_API_KEY set — skipping send to ${maskPhone(phone)}`);
    return { ok: false, error: 'no_api_key' };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    source: 'fitnessbymaddy-automation',
    buttons: params.buttons || []
  };

  try {
    const resp = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await resp.json();

    await logMessage(phone, 'out', `[template:${templateName}] ${(params.templateParams || []).join(', ')}`, templateName);

    return { ok: resp.ok, result };
  } catch (err) {
    console.error(`[WA] Send failed to ${maskPhone(phone)}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function sendText(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error(`[WA] No AISENSY_API_KEY set — skipping text to ${maskPhone(phone)}`);
    return { ok: false, error: 'no_api_key' };
  }

  const body = {
    apiKey,
    campaignName: 'text_message',
    destination: phone.replace('+', ''),
    message: text,
    source: 'fitnessbymaddy-automation'
  };

  try {
    const resp = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await resp.json();

    await logMessage(phone, 'out', text, null);

    return { ok: resp.ok, result };
  } catch (err) {
    console.error(`[WA] Text send failed to ${maskPhone(phone)}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function notifyMaddy(reason, context) {
  const text = `ESCALATION\nReason: ${reason}\nPhone: ${context.phone || 'unknown'}\nMessage: ${context.message || 'N/A'}`;
  return sendText(MADDY_PHONE, text);
}

async function logMessage(phone, direction, body, templateName) {
  const sb = getSupabase();
  await sb.from('messages').insert({
    phone,
    direction,
    body: (body || '').slice(0, 2000),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

module.exports = {
  canSendToLead,
  sendTemplate,
  sendText,
  notifyMaddy,
  logMessage,
  MADDY_PHONE
};

const { getSupabase } = require('./supabase');
const { maskPhone } = require('./utils');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendToLead(phone) {
  const sb = getSupabase();
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data } = await sb
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .order('sent_at', { ascending: false })
    .limit(1);
  return !data || data.length === 0;
}

async function sendTemplate(phone, templateName, params = [], isClient = false) {
  if (!isClient) {
    const allowed = await canSendToLead(phone);
    if (!allowed) {
      console.log(`Rate-limited: skipping send to ${maskPhone(phone)}`);
      return { ok: false, reason: 'rate_limited' };
    }
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { ok: false, reason: 'no_api_key' };
  }

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation'
  };

  try {
    const resp = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await resp.json();

    await logMessage(phone, 'out', params.join(' | '), templateName);

    return { ok: resp.ok, result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function sendFreeform(phone, text, isClient = false) {
  if (!isClient) {
    const allowed = await canSendToLead(phone);
    if (!allowed) {
      console.log(`Rate-limited: skipping send to ${maskPhone(phone)}`);
      return { ok: false, reason: 'rate_limited' };
    }
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { ok: false, reason: 'no_api_key' };
  }

  const payload = {
    apiKey,
    campaignName: 'freeform_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    message: text,
    source: 'automation'
  };

  try {
    const resp = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await resp.json();

    await logMessage(phone, 'out', text, null);

    return { ok: resp.ok, result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function logMessage(phone, direction, body, templateName) {
  const sb = getSupabase();
  await sb.from('messages').insert({
    phone,
    direction,
    body: body ? body.slice(0, 2000) : null,
    template_name: templateName,
    sent_at: new Date().toISOString()
  });
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  const text = `ESCALATION: ${subject}\n\n${details}`;
  await sendFreeform(maddyPhone, text, true);
}

module.exports = {
  sendTemplate,
  sendFreeform,
  logMessage,
  notifyMaddy,
  canSendToLead
};

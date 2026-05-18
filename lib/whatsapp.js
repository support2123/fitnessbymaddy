const { supabase } = require('./supabase');
const { maskPhone } = require('./utils');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function checkRateLimit(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    const lastSent = new Date(data[0].sent_at).getTime();
    if (Date.now() - lastSent < RATE_LIMIT_MS) return false;
  }
  return true;
}

async function sendTemplate(phone, templateName, params = [], skipRateLimit = false) {
  if (!skipRateLimit) {
    const allowed = await checkRateLimit(phone);
    if (!allowed) {
      console.log(`Rate limited: ${maskPhone(phone)}, template: ${templateName}`);
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
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation'
  };

  try {
    const resp = await fetch(`${AISENSY_BASE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await resp.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: params.join(' | '),
      template_name: templateName,
      status: resp.ok ? 'sent' : 'failed'
    });

    return { ok: resp.ok, data: result };
  } catch (err) {
    console.error(`WhatsApp send error for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function sendFreeform(phone, message, skipRateLimit = false) {
  if (!skipRateLimit) {
    const allowed = await checkRateLimit(phone);
    if (!allowed) return { ok: false, reason: 'rate_limited' };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { ok: false, reason: 'no_api_key' };

  const payload = {
    apiKey,
    campaignName: 'freeform_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message,
    source: 'automation'
  };

  try {
    const resp = await fetch(`${AISENSY_BASE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: message,
      template_name: null,
      status: resp.ok ? 'sent' : 'failed'
    });

    return { ok: resp.ok };
  } catch (err) {
    console.error(`WhatsApp freeform error for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  const msg = `🚨 ${subject}\n\n${details}`;
  return sendFreeform(maddyPhone, msg, true);
}

module.exports = { sendTemplate, sendFreeform, notifyMaddy, checkRateLimit };

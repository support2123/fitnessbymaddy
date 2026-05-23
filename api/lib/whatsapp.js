const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function checkRateLimit(phone) {
  const sb = getSupabase();
  const { data } = await sb
    .from('rate_limits')
    .select('last_sent_at')
    .eq('phone', phone)
    .single();

  if (!data) return true;
  const elapsed = Date.now() - new Date(data.last_sent_at).getTime();
  return elapsed >= RATE_LIMIT_MS;
}

async function updateRateLimit(phone) {
  const sb = getSupabase();
  await sb
    .from('rate_limits')
    .upsert({ phone, last_sent_at: new Date().toISOString() }, { onConflict: 'phone' });
}

async function sendTemplate(phone, templateName, params) {
  const allowed = await checkRateLimit(phone);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { rateLimited: true };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/\D/g, ''),
    userName: 'FitnessByMaddy',
    templateParams: params || []
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();

  await updateRateLimit(phone);
  await logMessage(phone, 'out', `[template:${templateName}]`, templateName);

  return result;
}

async function sendText(phone, text) {
  const allowed = await checkRateLimit(phone);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { rateLimited: true };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone.replace(/\D/g, ''),
    userName: 'FitnessByMaddy',
    message: { type: 'text', text }
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();

  await updateRateLimit(phone);
  await logMessage(phone, 'out', text, null);

  return result;
}

async function logMessage(phone, direction, body, templateName) {
  const sb = getSupabase();
  await sb.from('messages').insert({
    phone,
    direction,
    body: body ? body.substring(0, 4000) : null,
    template_name: templateName,
    sent_at: new Date().toISOString()
  });
}

async function notifyMaddy(reason, details) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  const text = `ESCALATION: ${reason}\n\n${details}`;
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'escalation_alert',
    destination: maddyPhone.replace(/\D/g, ''),
    userName: 'FitnessByMaddy',
    templateParams: [reason, details.substring(0, 500)]
  };

  try {
    await fetch(AISENSY_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) {
    console.error('Failed to notify Maddy:', e.message);
  }
}

module.exports = { sendTemplate, sendText, logMessage, notifyMaddy, checkRateLimit };

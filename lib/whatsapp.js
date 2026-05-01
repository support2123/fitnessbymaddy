const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '917082478374';

async function sendTemplate(phone, templateName, params) {
  const db = getSupabase();

  const canSend = await checkRateLimit(phone);
  if (!canSend) return { ok: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params || [],
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone: phone,
    direction: 'out',
    body: params ? params.join(' | ') : templateName,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  if (res.ok) {
    await db.from('rate_limits').upsert(
      { phone, last_sent_at: new Date().toISOString() },
      { onConflict: 'phone' }
    );
  }

  return { ok: res.ok, result };
}

async function sendText(phone, text) {
  const db = getSupabase();

  const canSend = await checkRateLimit(phone);
  if (!canSend) return { ok: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: text,
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: res.ok ? 'sent' : 'failed',
  });

  if (res.ok) {
    await db.from('rate_limits').upsert(
      { phone, last_sent_at: new Date().toISOString() },
      { onConflict: 'phone' }
    );
  }

  return { ok: res.ok };
}

async function checkRateLimit(phone) {
  const db = getSupabase();
  const { data } = await db
    .from('rate_limits')
    .select('last_sent_at')
    .eq('phone', phone)
    .single();

  if (!data) return true;

  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  return new Date(data.last_sent_at).getTime() < twoHoursAgo;
}

async function notifyMaddy(reason, details) {
  const text = `🚨 ESCALATION: ${reason}\n\n${details}`;
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, details]);
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

module.exports = { sendTemplate, sendText, checkRateLimit, notifyMaddy, maskPhone, MADDY_PHONE };

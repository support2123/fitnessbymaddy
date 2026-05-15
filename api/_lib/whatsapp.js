const { getSupabase } = require('./supabase');
const { maskPhone } = require('./utils');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendTo(phone) {
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
  if (!apiKey) {
    console.error(`[WA] No AISENSY_API_KEY configured — skipping send to ${maskPhone(phone)}`);
    return { ok: false, error: 'no_api_key' };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    media: {}
  };

  const resp = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await resp.json();

  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: `[template: ${templateName}]`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: resp.ok ? 'sent' : 'failed'
  });

  return { ok: resp.ok, data: result };
}

async function sendText(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error(`[WA] No AISENSY_API_KEY — skipping text to ${maskPhone(phone)}`);
    return { ok: false, error: 'no_api_key' };
  }

  const body = {
    apiKey,
    campaignName: 'text_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    message: { text }
  };

  const resp = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await resp.json();

  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    sent_at: new Date().toISOString(),
    status: resp.ok ? 'sent' : 'failed'
  });

  return { ok: resp.ok, data: result };
}

async function sendWithRateLimit(phone, templateName, params) {
  const allowed = await canSendTo(phone);
  if (!allowed) {
    console.log(`[WA] Rate-limited: ${maskPhone(phone)} — skipping ${templateName}`);
    return { ok: false, error: 'rate_limited' };
  }
  return sendTemplate(phone, templateName, params);
}

async function notifyMaddy(reason, details) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  const msg = `🚨 ESCALATION\nReason: ${reason}\n${details}`;
  return sendText(maddyPhone, msg);
}

module.exports = {
  canSendTo,
  sendTemplate,
  sendText,
  sendWithRateLimit,
  notifyMaddy
};

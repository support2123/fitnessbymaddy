const { getSupabase } = require('./supabase');
const { maskPhone } = require('./pii');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendTemplate(phone, templateName, params = []) {
  const db = getSupabase();

  const rateLimited = await isRateLimited(phone);
  if (rateLimited) {
    console.log(`Rate-limited: skipping send to ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation'
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const status = res.ok ? 'sent' : 'failed';

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: params.join(' | ') || templateName,
    template_name: templateName,
    status
  });

  return { ok: res.ok, status };
}

async function sendFreeform(phone, text) {
  const db = getSupabase();

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_reply',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: { text },
    source: 'automation'
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    template_name: null,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok };
}

async function isRateLimited(phone) {
  const db = getSupabase();
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);

  return data && data.length > 0;
}

module.exports = { sendTemplate, sendFreeform, isRateLimited };

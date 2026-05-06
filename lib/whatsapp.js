const { getSupabase } = require('./supabase');
const { maskPhone } = require('./utils');

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSend(phone) {
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

async function sendTemplate(phone, templateName, params = []) {
  const supabase = getSupabase();
  const { data: client } = await supabase
    .from('clients')
    .select('status')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  const isClient = client && client.length > 0;
  if (!isClient) {
    const allowed = await canSend(phone);
    if (!allowed) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { ok: false, reason: 'rate_limited' };
    }
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: params[0] || 'there',
    templateParams: params,
  };

  const resp = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await resp.json().catch(() => ({}));

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[template:${templateName}] ${params.join(', ')}`,
    template_name: templateName,
    status: resp.ok ? 'sent' : 'failed',
  });

  return { ok: resp.ok, result };
}

async function sendSessionMessage(phone, text) {
  const supabase = getSupabase();

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'session_message',
    destination: phone.replace(/^\+/, ''),
    message: text,
  };

  const resp = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: resp.ok ? 'sent' : 'failed',
  });

  return { ok: resp.ok };
}

async function logIncoming(phone, body) {
  const supabase = getSupabase();
  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body,
  });
}

module.exports = { sendTemplate, sendSessionMessage, logIncoming, canSend };

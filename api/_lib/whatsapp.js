const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function canSendMessage(phone, isClient) {
  if (isClient) return true;
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);
  return (count || 0) === 0;
}

async function sendTemplate(phone, templateName, params = []) {
  const allowed = await canSendMessage(phone, false);
  if (!allowed) {
    console.log(`Rate-limited: skipping send to ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: params.join(' | '),
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok, result };
}

async function sendFreeform(phone, body) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_reply',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    message: { text: body },
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body,
    template_name: null,
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok };
}

async function logIncoming(phone, body) {
  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body,
    template_name: null,
  });
}

module.exports = { sendTemplate, sendFreeform, logIncoming, canSendMessage };

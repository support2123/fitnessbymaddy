import supabase from './supabase.js';

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

export async function sendTemplate(phone, templateName, params = []) {
  const canSend = await checkRateLimit(phone);
  if (!canSend) return { ok: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  await logMessage(phone, 'out', params.join(' | '), templateName);

  return { ok: res.ok, data };
}

export async function sendText(phone, text) {
  const canSend = await checkRateLimit(phone);
  if (!canSend) return { ok: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: { type: 'text', text },
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  await logMessage(phone, 'out', text, null);

  return { ok: res.ok, data };
}

async function checkRateLimit(phone) {
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();

  if (client) return true;

  const { data: recent } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!recent) return true;

  const elapsed = Date.now() - new Date(recent.sent_at).getTime();
  return elapsed >= RATE_LIMIT_MS;
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

export { logMessage };

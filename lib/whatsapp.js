const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendTemplate(phone, templateName, params = []) {
  const db = getSupabase();

  const isClient = await isOptedInClient(phone);
  if (!isClient) {
    const canSend = await checkRateLimit(phone);
    if (!canSend) return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: params.join(' | ') || templateName,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok, data: result };
}

async function sendFreeform(phone, message) {
  const db = getSupabase();

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_text',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: message,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok };
}

async function sendMediaMessage(phone, mediaUrl, caption) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'media_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    media: { url: mediaUrl, filename: 'program.pdf' },
    message: caption || ''
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: caption || `[PDF] ${mediaUrl}`,
    template_name: 'media_message',
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok };
}

async function checkRateLimit(phone) {
  const db = getSupabase();
  const since = new Date(Date.now() - RATE_LIMIT_MS).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', since)
    .limit(1);

  return !data || data.length === 0;
}

async function isOptedInClient(phone) {
  const db = getSupabase();
  const { data } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  return data && data.length > 0;
}

module.exports = { sendTemplate, sendFreeform, sendMediaMessage, checkRateLimit };

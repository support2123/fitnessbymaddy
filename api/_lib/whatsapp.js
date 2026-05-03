const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendMessage(phone, isClient) {
  if (isClient) return true;
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

async function sendTemplate(phone, templateName, params, isClient) {
  if (!(await canSendMessage(phone, isClient))) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { rateLimited: true };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: `[template:${templateName}] ${(params || []).join(', ')}`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  return result;
}

async function sendText(phone, text, isClient) {
  if (!(await canSendMessage(phone, isClient))) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { rateLimited: true };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  const payload = {
    apiKey,
    campaignName: 'text_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    message: { type: 'text', text },
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    template_name: null,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  return result;
}

async function sendMedia(phone, mediaUrl, caption, isClient) {
  if (!(await canSendMessage(phone, isClient))) {
    return { rateLimited: true };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  const payload = {
    apiKey,
    campaignName: 'media_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    media: { url: mediaUrl, filename: 'program.pdf' },
    message: { type: 'document', text: caption || '' },
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: `[media] ${caption || mediaUrl}`,
    template_name: null,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  return result;
}

module.exports = { sendTemplate, sendText, sendMedia, canSendMessage };

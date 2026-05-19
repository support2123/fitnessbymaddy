const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function canSendMessage(phone, isClient) {
  if (isClient) return true;
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);
  return !data || data.length === 0;
}

async function sendTemplate(phone, templateName, params) {
  const allowed = await canSendMessage(phone, false);
  if (!allowed) return { ok: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();
  await logMessage(phone, 'out', `[template:${templateName}] ${(params || []).join(', ')}`, templateName);
  return { ok: res.ok, result };
}

async function sendText(phone, text, isClient) {
  const allowed = await canSendMessage(phone, isClient);
  if (!allowed) return { ok: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: text,
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();
  await logMessage(phone, 'out', text, null);
  return { ok: res.ok, result };
}

async function sendMediaMessage(phone, mediaUrl, caption, isClient) {
  const allowed = await canSendMessage(phone, isClient);
  if (!allowed) return { ok: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'media_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: caption || '',
    source: 'automation',
    media: { url: mediaUrl, filename: 'program.pdf' },
    buttons: [],
    carouselCards: [],
    location: {}
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();
  await logMessage(phone, 'out', `[media] ${caption || mediaUrl}`, null);
  return { ok: res.ok, result };
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

module.exports = { sendTemplate, sendText, sendMediaMessage, logMessage, canSendMessage };

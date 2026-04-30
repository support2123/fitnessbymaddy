const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params = []) {
  if (await isOptedOut(phone)) return null;
  if (await isRateLimited(phone)) return null;

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
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

  const data = await res.json();

  await logMessage(phone, 'out', `[template:${templateName}] ${params.join(', ')}`, templateName);

  return data;
}

async function sendText(phone, text) {
  if (await isOptedOut(phone)) return null;
  if (await isRateLimited(phone)) return null;

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'session_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: text,
    source: 'automation'
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  await logMessage(phone, 'out', text, null);
  return data;
}

async function sendMedia(phone, mediaUrl, caption) {
  if (await isOptedOut(phone)) return null;

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'media_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    media: { url: mediaUrl, filename: 'program.pdf' },
    caption: caption || '',
    source: 'automation'
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  await logMessage(phone, 'out', `[media] ${caption || mediaUrl}`, null);
  return data;
}

async function isOptedOut(phone) {
  const db = getSupabase();
  const { data } = await db
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .single();

  return data?.status === 'dropped';
}

async function isRateLimited(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  if (client) return false;

  const { count } = await db
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return count >= 1;
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

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  await sendText(maddyPhone, `🚨 ESCALATION: ${subject}\n\n${details}`);
}

module.exports = { sendTemplate, sendText, sendMedia, logMessage, notifyMaddy, isOptedOut };

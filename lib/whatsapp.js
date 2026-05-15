const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendWhatsApp({ phone, templateName, body, params }) {
  const db = getSupabase();

  const isOptedOut = await checkOptOut(db, phone);
  if (isOptedOut) return { sent: false, reason: 'opted_out' };

  const withinLimit = await checkRateLimit(db, phone);
  if (!withinLimit) return { sent: false, reason: 'rate_limited' };

  const payload = {
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

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || templateName,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return { sent: res.ok, result };
}

async function checkOptOut(db, phone) {
  const { data } = await db
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .single();
  return data?.status === 'dropped';
}

async function checkRateLimit(db, phone) {
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

async function sendWhatsAppDirect({ phone, templateName, body, params }) {
  const db = getSupabase();

  const payload = {
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

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || templateName,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return { sent: res.ok, result };
}

module.exports = { sendWhatsApp, sendWhatsAppDirect };

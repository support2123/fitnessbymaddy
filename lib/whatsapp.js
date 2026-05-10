const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, params = [], body = '' }) {
  const rateLimited = await checkRateLimit(phone);
  if (rateLimited) {
    console.log(`Rate limited: skipping message to ${phone.slice(0, 3)}XXX...${phone.slice(-3)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { ok: false, reason: 'no_api_key' };
  }

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params.length > 0 ? params : undefined,
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    await logMessage({
      phone,
      direction: 'out',
      body: body || templateName,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok, data };
  } catch (err) {
    console.error('WhatsApp send error:', err.message);
    await logMessage({
      phone,
      direction: 'out',
      body: body || templateName,
      template_name: templateName,
      status: 'error'
    });
    return { ok: false, reason: err.message };
  }
}

async function checkRateLimit(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return data && data.length > 0;
}

async function logMessage({ phone, direction, body, template_name, status }) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body ? body.slice(0, 500) : '',
    template_name: template_name || null,
    sent_at: new Date().toISOString(),
    status: status || 'sent'
  });
}

async function sendWhatsAppToClient(phone, templateName, params, body) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { ok: false, reason: 'no_api_key' };

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params && params.length > 0 ? params : undefined,
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    await logMessage({
      phone,
      direction: 'out',
      body: body || templateName,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok, data };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

module.exports = { sendWhatsApp, sendWhatsAppToClient, logMessage, checkRateLimit };

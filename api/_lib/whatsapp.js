const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, bodyText, mediaUrl) {
  const db = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not set');
    return { ok: false, error: 'api_key_missing' };
  }

  const rateLimited = await checkRateLimit(db, phone);
  if (rateLimited) {
    return { ok: false, error: 'rate_limited' };
  }

  const payload = {
    apiKey,
    campaignName: templateName || 'direct_message',
    destination: phone.replace(/[^0-9]/g, ''),
    userName: 'FitnessByMaddy',
    source: 'automation'
  };

  if (templateName) {
    payload.templateParams = [];
    payload.media = {};
    if (mediaUrl) {
      payload.media.url = mediaUrl;
      payload.media.filename = 'program.pdf';
    }
  } else if (bodyText) {
    payload.message = bodyText;
  }

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: bodyText || `[template: ${templateName}]`,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok, data };
  } catch (err) {
    console.error('WhatsApp send error:', err.message);
    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: bodyText || `[template: ${templateName}]`,
      template_name: templateName,
      status: 'error'
    });
    return { ok: false, error: err.message };
  }
}

async function checkRateLimit(db, phone) {
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

async function sendWhatsAppUnlimited(phone, templateName, bodyText, mediaUrl) {
  const db = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { ok: false, error: 'api_key_missing' };

  const payload = {
    apiKey,
    campaignName: templateName || 'direct_message',
    destination: phone.replace(/[^0-9]/g, ''),
    userName: 'FitnessByMaddy',
    source: 'automation'
  };

  if (templateName) {
    payload.templateParams = [];
    payload.media = {};
    if (mediaUrl) {
      payload.media.url = mediaUrl;
      payload.media.filename = 'program.pdf';
    }
  } else if (bodyText) {
    payload.message = bodyText;
  }

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: bodyText || `[template: ${templateName}]`,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok, data };
  } catch (err) {
    console.error('WhatsApp send error:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendWhatsApp, sendWhatsAppUnlimited };

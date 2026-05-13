const { supabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendWhatsApp(phone, body, templateName) {
  await logMessage(phone, 'out', body, templateName);

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { ok: false, error: 'API key missing' };
  }

  const payload = {
    apiKey,
    campaignName: templateName || 'direct_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: [],
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  if (templateName) {
    payload.templateParams = Array.isArray(body) ? body : [body];
  } else {
    payload.message = body;
  }

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (err) {
    console.error('WhatsApp send error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function sendTemplate(phone, templateName, params) {
  await logMessage(phone, 'out', JSON.stringify(params), templateName);

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { ok: false, error: 'API key missing' };

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'automation'
  };

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function checkRateLimit(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return false;
  const lastSent = new Date(data[0].sent_at).getTime();
  return (Date.now() - lastSent) < RATE_LIMIT_MS;
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body: (body || '').slice(0, 2000),
    template_name: templateName || null,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

module.exports = { sendWhatsApp, sendTemplate, checkRateLimit, logMessage };

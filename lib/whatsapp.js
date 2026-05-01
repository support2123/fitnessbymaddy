const { getSupabase } = require('./supabase');
const { maskPhone } = require('./phone');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, params = [], body = '' }) {
  const db = getSupabase();

  const rateOk = await checkRateLimit(db, phone);
  if (!rateOk) {
    console.log(`Rate-limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params.length ? params : undefined,
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  if (body && !templateName) {
    payload.message = body;
  }

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    const status = res.ok ? 'sent' : 'failed';

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: body || `[template:${templateName}]`,
      template_name: templateName || null,
      sent_at: new Date().toISOString(),
      status
    });

    return { ok: res.ok, data };
  } catch (err) {
    console.error(`WA send failed for ${maskPhone(phone)}:`, err.message);

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: body || `[template:${templateName}]`,
      template_name: templateName || null,
      sent_at: new Date().toISOString(),
      status: 'error'
    });

    return { ok: false, reason: err.message };
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

  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  if (client && client.length > 0) return true;
  return !data || data.length === 0;
}

async function notifyMaddy(reason, details) {
  const maddy = process.env.MADDY_PHONE || '+917082478374';
  await sendWhatsApp({
    phone: maddy,
    templateName: 'escalation_alert',
    params: [reason, details]
  });
}

module.exports = { sendWhatsApp, notifyMaddy };

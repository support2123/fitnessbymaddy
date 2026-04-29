const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '917082478374';

async function sendWhatsApp({ phone, templateName, body, params }) {
  const db = getSupabase();

  const rateLimited = await checkRateLimit(db, phone);
  if (rateLimited) {
    console.log(`Rate limited: ${phone.slice(0, 3)}XXX...${phone.slice(-3)}`);
    return { sent: false, reason: 'rate_limited' };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { sent: false, reason: 'no_api_key' };
  }

  const payload = {
    apiKey,
    campaignName: templateName || 'direct_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params || [],
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
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: body || `[template:${templateName}]`,
      template_name: templateName || null,
      status: res.ok ? 'sent' : 'failed'
    });

    return { sent: res.ok, result };
  } catch (err) {
    console.error('WhatsApp send error:', err.message);
    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: body || `[template:${templateName}]`,
      template_name: templateName || null,
      status: 'error'
    });
    return { sent: false, reason: err.message };
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

async function notifyMaddy(message) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return;

  try {
    await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        campaignName: 'admin_alert',
        destination: MADDY_PHONE,
        userName: 'System',
        templateParams: [message],
        source: 'automation'
      })
    });
  } catch (err) {
    console.error('Failed to notify Maddy:', err.message);
  }
}

module.exports = { sendWhatsApp, notifyMaddy, MADDY_PHONE };

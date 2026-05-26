const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendWhatsApp({ phone, templateName, body, params, isClient }) {
  const db = getSupabase();

  if (!isClient) {
    const twoHoursAgo = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
    const { data: recent } = await db
      .from('messages')
      .select('id')
      .eq('phone', phone)
      .eq('direction', 'out')
      .gte('sent_at', twoHoursAgo)
      .limit(1);

    if (recent && recent.length > 0) {
      console.log(`Rate limited: skipping message to ${maskPhone(phone)}`);
      return { sent: false, reason: 'rate_limited' };
    }
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { sent: false, reason: 'no_api_key' };
  }

  const payload = {
    apiKey,
    campaignName: templateName || 'direct_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'automation',
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

    const result = await res.json();

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: body || (params ? params.join(' | ') : templateName),
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { sent: res.ok, result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: body || templateName,
      template_name: templateName,
      status: 'error'
    });

    return { sent: false, reason: err.message };
  }
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  return sendWhatsApp({
    phone: maddyPhone,
    templateName: 'escalation_alert',
    body: `ESCALATION: ${subject}\n${details}`,
    params: [subject, details],
    isClient: true
  });
}

module.exports = { sendWhatsApp, notifyMaddy };

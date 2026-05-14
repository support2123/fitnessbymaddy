const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendWhatsApp({ phone, templateName, body, params, isClient }) {
  const supabase = getSupabase();

  if (!isClient) {
    const { data: recent } = await supabase
      .from('messages')
      .select('sent_at')
      .eq('phone', phone)
      .eq('direction', 'out')
      .order('sent_at', { ascending: false })
      .limit(1);

    if (recent && recent.length > 0) {
      const lastSent = new Date(recent[0].sent_at).getTime();
      if (Date.now() - lastSent < RATE_LIMIT_MS) {
        console.log(`Rate limited for ${maskPhone(phone)}`);
        return { sent: false, reason: 'rate_limited' };
      }
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

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: body || `[template: ${templateName}]`,
      template_name: templateName || null,
      status: res.ok ? 'sent' : 'failed'
    });

    return { sent: res.ok, result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: body || `[template: ${templateName}]`,
      template_name: templateName || null,
      status: 'error'
    });

    return { sent: false, reason: err.message };
  }
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  const body = `[ESCALATION] ${subject}\n${details}`;
  return sendWhatsApp({
    phone: maddyPhone,
    body,
    isClient: true
  });
}

module.exports = { sendWhatsApp, notifyMaddy };

const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendWhatsApp({ phone, templateName, body, params, isClient }) {
  if (!isClient) {
    const canSend = await checkRateLimit(phone);
    if (!canSend) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { sent: false, reason: 'rate_limited' };
    }
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
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
      body: body || `template:${templateName}`,
      template_name: templateName || null,
      status: res.ok ? 'sent' : 'failed'
    });

    return { sent: res.ok, result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: body || `template:${templateName}`,
      template_name: templateName || null,
      status: 'error'
    });
    return { sent: false, error: err.message };
  }
}

async function checkRateLimit(phone) {
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);

  return !data || data.length === 0;
}

async function sendEscalation(reason, phone, messageText) {
  const MADDY_PHONE = '+917082478374';
  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    params: [reason, maskPhone(phone), (messageText || '').slice(0, 100)],
    isClient: true
  });
}

module.exports = { sendWhatsApp, checkRateLimit, sendEscalation };

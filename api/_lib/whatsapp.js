const { supabase } = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendWhatsApp({ phone, templateName, body, params = [] }) {
  const rateLimited = await checkRateLimit(phone);
  if (rateLimited) {
    console.log(`Rate limited for ${maskPhone(phone)}, skipping`);
    return { success: false, reason: 'rate_limited' };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { success: false, reason: 'no_api_key' };
  }

  try {
    const payload = {
      apiKey,
      campaignName: templateName || 'manual_message',
      destination: phone.replace(/^\+/, ''),
      userName: 'FitnessByMaddy',
      templateParams: params.length > 0 ? params : undefined,
      message: body || undefined
    };

    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: body || `[template: ${templateName}]`,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { success: res.ok, data };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

async function checkRateLimit(phone) {
  const twoHoursAgo = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return data && data.length > 0;
}

async function sendEscalation(message) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  await sendWhatsApp({
    phone: maddyPhone,
    body: `🚨 ESCALATION: ${message}`,
    templateName: 'escalation_alert'
  });
}

module.exports = { sendWhatsApp, sendEscalation, checkRateLimit };

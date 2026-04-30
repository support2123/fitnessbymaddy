const { supabase } = require('./supabase');
const { maskPhone } = require('./pii');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, message, templateName) {
  const rateOk = await checkRateLimit(phone);
  if (!rateOk) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  try {
    const payload = templateName
      ? {
          apiKey: process.env.AISENSY_API_KEY,
          campaignName: templateName,
          destination: phone,
          userName: 'FitnessByMaddy',
          templateParams: [],
          source: 'automation',
          media: {},
          buttons: [],
          carouselCards: [],
          location: {}
        }
      : {
          apiKey: process.env.AISENSY_API_KEY,
          campaignName: 'direct_message',
          destination: phone,
          userName: 'FitnessByMaddy',
          templateParams: [message],
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

    const data = await res.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: message || `[template: ${templateName}]`,
      template_name: templateName || null,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok, data };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function checkRateLimit(phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  if (client && client.length > 0) return true;
  return !data || data.length === 0;
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  if (phone.startsWith('91') || phone.startsWith('+91')) return 'IN';
  if (phone.startsWith('971') || phone.startsWith('+971')) return 'UAE';
  if (phone.startsWith('44') || phone.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}

module.exports = { sendWhatsApp, detectMarket };

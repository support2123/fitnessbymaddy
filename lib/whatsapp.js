const { supabase } = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params = []) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('[WhatsApp] AISENSY_API_KEY not set');
    return { success: false, error: 'API key missing' };
  }

  const rateLimited = await checkRateLimit(phone);
  if (rateLimited) {
    console.log(`[WhatsApp] Rate limited for ${maskPhone(phone)}`);
    return { success: false, error: 'rate_limited' };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
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
      body: JSON.stringify(body)
    });

    const data = await res.json();

    await logMessage(phone, 'out', `[template: ${templateName}] ${params.join(', ')}`, templateName);

    return { success: res.ok, data };
  } catch (err) {
    console.error(`[WhatsApp] Send failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, error: err.message };
  }
}

async function sendText(phone, message) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { success: false, error: 'API key missing' };

  const rateLimited = await checkRateLimit(phone);
  if (rateLimited) return { success: false, error: 'rate_limited' };

  const body = {
    apiKey,
    campaignName: 'text_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message,
    source: 'automation'
  };

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    await logMessage(phone, 'out', message, null);
    return { success: res.ok, data };
  } catch (err) {
    console.error(`[WhatsApp] Text send failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, error: err.message };
  }
}

async function checkRateLimit(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .order('sent_at', { ascending: false })
    .limit(1);

  return data && data.length > 0;
}

async function checkRateLimitForClient(phone) {
  return false;
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body: body?.substring(0, 2000),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

module.exports = {
  sendTemplate,
  sendText,
  logMessage,
  checkRateLimit
};

const { getSupabase } = require('./supabase');
const { maskPhone } = require('./masking');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function checkRateLimit(phone, isClient) {
  if (isClient) return true;
  const db = getSupabase();
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);
  return !data || data.length === 0;
}

async function sendWhatsApp(phone, body, templateName, isClient = false) {
  const allowed = await checkRateLimit(phone, isClient);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { sent: false, reason: 'rate_limited' };
  }

  let result;
  const apiKey = process.env.AISENSY_API_KEY;

  if (apiKey) {
    result = await sendViaAiSensy(phone, body, templateName, apiKey);
  } else {
    result = await sendViaMetaCloudAPI(phone, body, templateName);
  }

  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body.slice(0, 1000),
    template_name: templateName || null,
    sent_at: new Date().toISOString(),
    status: result.sent ? 'sent' : 'failed'
  });

  return result;
}

async function sendViaAiSensy(phone, body, templateName, apiKey) {
  try {
    const payload = {
      apiKey,
      campaignName: templateName || 'direct_message',
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      source: 'automation',
      message: body
    };

    if (templateName) {
      payload.templateParams = [];
    }

    const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    return { sent: res.ok, provider: 'aisensy', response: data };
  } catch (err) {
    console.error(`AiSensy send failed for ${maskPhone(phone)}:`, err.message);
    return { sent: false, provider: 'aisensy', error: err.message };
  }
}

async function sendViaMetaCloudAPI(phone, body, templateName) {
  try {
    const token = process.env.META_WA_TOKEN;
    const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
      console.error('Meta Cloud API credentials not configured');
      return { sent: false, provider: 'meta', error: 'not_configured' };
    }

    const payload = templateName
      ? {
          messaging_product: 'whatsapp',
          to: phone.replace('+', ''),
          type: 'template',
          template: { name: templateName, language: { code: 'en' } }
        }
      : {
          messaging_product: 'whatsapp',
          to: phone.replace('+', ''),
          type: 'text',
          text: { body }
        };

    const res = await fetch(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      }
    );

    const data = await res.json();
    return { sent: res.ok, provider: 'meta', response: data };
  } catch (err) {
    console.error(`Meta send failed for ${maskPhone(phone)}:`, err.message);
    return { sent: false, provider: 'meta', error: err.message };
  }
}

module.exports = { sendWhatsApp, checkRateLimit };

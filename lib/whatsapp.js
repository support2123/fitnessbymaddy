const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsAppMessage(phone, body, templateName) {
  const db = getSupabase();

  if (templateName !== '_internal_escalation') {
    const canSend = await checkRateLimit(db, phone);
    if (!canSend) return { sent: false, reason: 'rate_limited' };
  }

  let result;
  try {
    result = await sendViaAiSensy(phone, body, templateName);
  } catch (err) {
    console.error('AiSensy failed, trying Meta fallback:', err.message);
    result = await sendViaMetaAPI(phone, body, templateName);
  }

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || templateName,
    template_name: templateName || null,
    status: result.success ? 'sent' : 'failed'
  });

  return result;
}

async function sendViaAiSensy(phone, body, templateName) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not set');

  const payload = {
    apiKey,
    campaignName: templateName || 'direct_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: [],
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  if (body && !templateName) {
    payload.message = body;
  }

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AiSensy ${res.status}: ${text}`);
  }

  return { success: true, provider: 'aisensy' };
}

async function sendViaMetaAPI(phone, body, templateName) {
  const token = process.env.META_WA_TOKEN;
  const phoneId = process.env.META_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error('Meta API credentials not set');

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
    `https://graph.facebook.com/v21.0/${phoneId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta API ${res.status}: ${text}`);
  }

  return { success: true, provider: 'meta' };
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

  return !data || data.length === 0;
}

async function sendTemplate(phone, templateName, params) {
  return sendWhatsAppMessage(phone, null, templateName);
}

module.exports = { sendWhatsAppMessage, sendTemplate, checkRateLimit };

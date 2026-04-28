const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

async function sendWhatsApp({ phone, templateName, body, params }) {
  const db = getSupabase();

  const rateOk = await checkRateLimit(db, phone);
  if (!rateOk) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  let result;
  try {
    result = await sendViaAiSensy({ phone, templateName, body, params });
  } catch (err) {
    console.error(`AiSensy failed for ${maskPhone(phone)}: ${err.message}`);
    try {
      result = await sendViaMetaCloud({ phone, templateName, body, params });
    } catch (fallbackErr) {
      console.error(`Meta fallback failed for ${maskPhone(phone)}: ${fallbackErr.message}`);
      return { ok: false, reason: 'send_failed' };
    }
  }

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || templateName,
    template_name: templateName || null,
    status: 'sent'
  });

  return { ok: true, result };
}

async function sendViaAiSensy({ phone, templateName, body, params }) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not set');

  const payload = {
    apiKey,
    campaignName: templateName || 'direct_message',
    destination: phone,
    userName: params?.name || 'there',
    templateParams: params?.templateParams || [],
    source: 'fitnessbymaddy-automation',
    media: {},
    buttons: params?.buttons || [],
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

  return res.json();
}

async function sendViaMetaCloud({ phone, templateName, body, params }) {
  const token = process.env.META_WA_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) throw new Error('Meta Cloud API not configured');

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  let payload;
  if (templateName) {
    payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: params?.langCode || 'en' },
        components: params?.templateParams ? [{
          type: 'body',
          parameters: params.templateParams.map(p => ({ type: 'text', text: p }))
        }] : []
      }
    };
  } else {
    payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body }
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta ${res.status}: ${text}`);
  }

  return res.json();
}

async function checkRateLimit(db, phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  if (client) return true;

  const { count } = await db
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return (count || 0) < 1;
}

module.exports = { sendWhatsApp, maskPhone };

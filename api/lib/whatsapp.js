const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function checkRateLimit(phone, isClient) {
  if (isClient) return true;

  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return true;

  const lastSent = new Date(data[0].sent_at).getTime();
  return Date.now() - lastSent >= RATE_LIMIT_MS;
}

async function sendViaAiSensy(phone, message, templateName) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const payload = templateName
    ? {
        apiKey,
        campaignName: templateName,
        destination: phone.replace('+', ''),
        userName: 'FitnessByMaddy',
        templateParams: [],
        media: {},
      }
    : {
        apiKey,
        campaignName: 'direct_message',
        destination: phone.replace('+', ''),
        userName: 'FitnessByMaddy',
        message,
      };

  const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AiSensy API error: ${res.status} - ${errText}`);
  }

  return res.json();
}

async function sendViaMetaCloud(phone, message) {
  const token = process.env.META_WA_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) throw new Error('Meta Cloud API not configured');

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone.replace('+', ''),
        type: 'text',
        text: { body: message },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Meta Cloud API error: ${res.status} - ${errText}`);
  }

  return res.json();
}

async function sendWhatsApp(phone, message, templateName, isClient = false) {
  const allowed = await checkRateLimit(phone, isClient);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { rateLimited: true };
  }

  let result;
  try {
    result = await sendViaAiSensy(phone, message, templateName);
  } catch (err) {
    console.log(`AiSensy failed for ${maskPhone(phone)}, falling back to Meta Cloud: ${err.message}`);
    result = await sendViaMetaCloud(phone, message);
  }

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: message || `[Template: ${templateName}]`,
    template_name: templateName || null,
    status: 'sent',
  });

  return result;
}

async function logInboundMessage(phone, body) {
  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body,
    status: 'received',
  });
}

module.exports = { sendWhatsApp, logInboundMessage, checkRateLimit };

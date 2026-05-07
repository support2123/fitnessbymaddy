const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function checkRateLimit(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    const lastSent = new Date(data[0].sent_at).getTime();
    if (Date.now() - lastSent < RATE_LIMIT_MS) return false;
  }
  return true;
}

async function sendWhatsApp(phone, body, templateName, forceSkipRateLimit) {
  if (!forceSkipRateLimit) {
    const allowed = await checkRateLimit(phone);
    if (!allowed) {
      console.log(`Rate limited: skipping message to ${maskPhone(phone)}`);
      return { success: false, reason: 'rate_limited' };
    }
  }

  let success = false;
  let provider = 'aisensy';

  try {
    success = await sendViaAiSensy(phone, body, templateName);
  } catch (e) {
    console.error(`AiSensy failed for ${maskPhone(phone)}:`, e.message);
    try {
      success = await sendViaMetaCloudAPI(phone, body, templateName);
      provider = 'meta';
    } catch (e2) {
      console.error(`Meta Cloud API also failed for ${maskPhone(phone)}:`, e2.message);
      return { success: false, reason: 'all_providers_failed' };
    }
  }

  if (success) {
    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: body?.slice(0, 4000),
      template_name: templateName,
      status: 'sent'
    });
  }

  return { success, provider };
}

async function sendViaAiSensy(phone, body, templateName) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const payload = {
    apiKey,
    campaignName: templateName || 'direct_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message: body
  };

  if (templateName) {
    payload.templateParams = [];
    payload.source = 'automation';
  }

  const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AiSensy ${res.status}: ${text}`);
  }
  return true;
}

async function sendViaMetaCloudAPI(phone, body, templateName) {
  const token = process.env.META_WA_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) throw new Error('Meta Cloud API not configured');

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  let payload;
  if (templateName) {
    payload = {
      messaging_product: 'whatsapp',
      to: phone.replace('+', ''),
      type: 'template',
      template: { name: templateName, language: { code: 'en' } }
    };
  } else {
    payload = {
      messaging_product: 'whatsapp',
      to: phone.replace('+', ''),
      type: 'text',
      text: { body }
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta API ${res.status}: ${text}`);
  }
  return true;
}

async function logIncomingMessage(phone, body) {
  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body: body?.slice(0, 4000),
    status: 'received'
  });
}

module.exports = { sendWhatsApp, logIncomingMessage, checkRateLimit };

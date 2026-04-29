const { supabase } = require('./supabase');
const { maskPhone } = require('./utils');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const BUSINESS_PHONE = '+917082478374';

async function canSendMessage(phone, isClient) {
  if (isClient) return true;
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);
  return !data || data.length === 0;
}

async function sendTemplate(phone, templateName, params = {}) {
  const allowed = await canSendMessage(phone, false);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { success: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    source: 'fitnessbymaddy-automation',
    buttons: params.buttons || []
  };

  if (params.media) {
    body.media = params.media;
  }

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await res.json();

    await logMessage(phone, 'out', `[Template: ${templateName}]`, templateName);

    return { success: res.ok, data: result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

async function sendSessionMessage(phone, text) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'session_message',
    destination: phone.replace('+', ''),
    message: text,
    source: 'fitnessbymaddy-automation'
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await res.json();

    await logMessage(phone, 'out', text, null);

    return { success: res.ok, data: result };
  } catch (err) {
    console.error(`Session msg failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

async function notifyMaddy(subject, details) {
  const msg = `ESCALATION: ${subject}\n\n${details}`;
  await sendSessionMessage(BUSINESS_PHONE, msg);
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

module.exports = {
  sendTemplate,
  sendSessionMessage,
  notifyMaddy,
  logMessage,
  canSendMessage,
  BUSINESS_PHONE
};

const { getSupabase } = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params) {
  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.AISENSY_API_KEY}`
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params || [],
      source: 'automation',
      buttons: []
    })
  });

  const data = await res.json();

  await logMessage(phone, 'out', `[template:${templateName}]`, templateName);

  return data;
}

async function sendText(phone, text) {
  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.AISENSY_API_KEY}`
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: text,
      source: 'automation'
    })
  });

  const data = await res.json();

  await logMessage(phone, 'out', text, null);

  return data;
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body ? body.substring(0, 2000) : null,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

async function canSendMessage(phone) {
  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  if (client) return true;

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return !recent || recent.length === 0;
}

async function notifyMaddy(reason, phone, messageBody) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody ? messageBody.substring(0, 2000) : null
  });

  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  const masked = maskPhone(phone);
  await sendTemplate(maddyPhone, 'escalation_alert', [reason, masked]);
}

module.exports = { sendTemplate, sendText, logMessage, canSendMessage, notifyMaddy };

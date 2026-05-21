const { getClient } = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'automation'
  };

  const resp = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await resp.json();

  await logMessage(phone, 'out', params ? params.join(' | ') : templateName, templateName);

  return result;
}

async function sendText(phone, text) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message: text,
    source: 'automation'
  };

  const resp = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await resp.json();
  await logMessage(phone, 'out', text, null);
  return result;
}

async function canSendToLead(phone) {
  const db = getClient();
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

async function logMessage(phone, direction, body, templateName) {
  const db = getClient();
  await db.from('messages').insert({
    phone,
    direction,
    body: body ? body.substring(0, 2000) : null,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

async function notifyMaddy(reason, details) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  const text = `🚨 ESCALATION: ${reason}\n${details}`;
  await sendText(maddyPhone, text);
}

module.exports = {
  sendTemplate,
  sendText,
  canSendToLead,
  logMessage,
  notifyMaddy
};

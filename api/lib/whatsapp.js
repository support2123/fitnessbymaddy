const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const AISENSY_DIRECT = 'https://backend.aisensy.com/direct/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendToLead(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data } = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);
  return !data || data.length === 0;
}

async function sendTemplate(phone, templateName, params = [], mediaUrl) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation'
  };
  if (mediaUrl) {
    body.media = { url: mediaUrl, filename: 'program.pdf' };
  }

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const result = await res.json();

  await logMessage(phone, 'out', `[template:${templateName}] ${params.join(', ')}`, templateName);

  if (!res.ok) {
    console.error(`WhatsApp send failed to ${maskPhone(phone)}:`, result);
  }
  return result;
}

async function sendSessionMessage(phone, text) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'session_reply',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    message: text,
    source: 'automation'
  };

  const res = await fetch(AISENSY_DIRECT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  await logMessage(phone, 'out', text, null);
  return res.json();
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body?.slice(0, 2000),
    template_name: templateName,
    sent_at: new Date().toISOString()
  });
}

async function notifyMaddy(reason, details) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  await sendTemplate(maddyPhone, 'escalation_alert', [reason, details]);
}

module.exports = {
  sendTemplate,
  sendSessionMessage,
  logMessage,
  notifyMaddy,
  canSendToLead
};

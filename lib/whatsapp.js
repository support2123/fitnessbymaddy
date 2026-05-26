const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '917082478374';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith('91') || phone.startsWith('+91')) return 'IN';
  if (phone.startsWith('971') || phone.startsWith('+971')) return 'UAE';
  if (phone.startsWith('44') || phone.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}

function normalizePhone(phone) {
  return phone.replace(/[\s\-\+\(\)]/g, '');
}

async function canSendMessage(phone) {
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

async function sendTemplate(phone, templateName, params = []) {
  const allowed = await canSendMessage(phone);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { sent: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: normalizePhone(phone),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation'
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone: normalizePhone(phone),
    direction: 'out',
    body: params.join(' | ') || templateName,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return { sent: res.ok, result };
}

async function sendFreeformMessage(phone, message) {
  const allowed = await canSendMessage(phone);
  if (!allowed) return { sent: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_reply',
    destination: normalizePhone(phone),
    userName: 'FitnessByMaddy',
    message
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  await supabase.from('messages').insert({
    phone: normalizePhone(phone),
    direction: 'out',
    body: message,
    status: res.ok ? 'sent' : 'failed'
  });

  return { sent: res.ok };
}

async function notifyMaddy(reason, context) {
  await sendFreeformMessage(MADDY_PHONE,
    `🚨 ESCALATION\nReason: ${reason}\n${context}`
  );
  await supabase.from('escalations').insert({
    phone: MADDY_PHONE,
    reason,
    context
  });
}

async function logIncoming(phone, body) {
  await supabase.from('messages').insert({
    phone: normalizePhone(phone),
    direction: 'in',
    body,
    status: 'received'
  });
}

module.exports = {
  sendTemplate,
  sendFreeformMessage,
  notifyMaddy,
  logIncoming,
  detectMarket,
  normalizePhone,
  maskPhone,
  canSendMessage,
  MADDY_PHONE
};

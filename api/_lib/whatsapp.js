const { supabase } = require('./supabase');

const AISENSY_API_KEY = process.env.AISENSY_API_KEY;
const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '+917082478374';

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
  const isClient = await isActiveClient(phone);
  if (!isClient) {
    const allowed = await canSendMessage(phone);
    if (!allowed) return { ok: false, reason: 'rate_limited' };
  }

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      templateParams: params,
    }),
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[template: ${templateName}] ${params.join(', ')}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok, result };
}

async function sendTextMessage(phone, text) {
  const isClient = await isActiveClient(phone);
  if (!isClient) {
    const allowed = await canSendMessage(phone);
    if (!allowed) return { ok: false, reason: 'rate_limited' };
  }

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      message: text,
    }),
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok, result };
}

async function isActiveClient(phone) {
  const { data } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);
  return data && data.length > 0;
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

async function notifyMaddy(reason, context) {
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, context || '']);
}

module.exports = {
  sendTemplate,
  sendTextMessage,
  canSendMessage,
  isActiveClient,
  maskPhone,
  notifyMaddy,
  MADDY_PHONE,
};

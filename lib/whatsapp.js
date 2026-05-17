const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '917082478374';

async function sendTemplate(phone, templateName, params = []) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params,
    }),
  });

  const data = await res.json();

  const db = getSupabase();
  await db.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'out',
    body: params.join(' | '),
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return data;
}

async function sendText(phone, text) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: { text },
    }),
  });

  const data = await res.json();

  const db = getSupabase();
  await db.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'out',
    body: text,
    status: res.ok ? 'sent' : 'failed',
  });

  return data;
}

async function canSendMessage(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', maskPhone(phone))
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  const isClient = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  if (isClient.data && isClient.data.length > 0) return true;
  return !data || data.length === 0;
}

async function notifyMaddy(subject, details) {
  await sendText(MADDY_PHONE, `⚠️ ESCALATION: ${subject}\n\n${details}`);
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return phone;
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith('91')) return 'IN';
  if (phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

module.exports = {
  sendTemplate,
  sendText,
  canSendMessage,
  notifyMaddy,
  maskPhone,
  detectMarket,
  MADDY_PHONE,
};

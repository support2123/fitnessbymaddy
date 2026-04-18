const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '917082478374';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('91') && cleaned.length === 12) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

async function sendWhatsApp(phone, templateName, params = []) {
  const db = getSupabase();

  const recent = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();

  if (recent.data) {
    const lastSent = new Date(recent.data.sent_at);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const isClient = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (lastSent > twoHoursAgo && !isClient.data) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { rateLimited: true };
    }
  }

  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AiSensy-Project-API-Key': process.env.AISENSY_API_KEY
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params,
      source: 'automation',
      media: {}
    })
  });

  const result = await resp.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: params.join(' | '),
    template_name: templateName,
    status: resp.ok ? 'sent' : 'failed'
  });

  return result;
}

async function sendFreeformWhatsApp(phone, message) {
  const db = getSupabase();

  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AiSensy-Project-API-Key': process.env.AISENSY_API_KEY
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'session_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: [message],
      source: 'automation',
      media: {}
    })
  });

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: message,
    template_name: 'session_message',
    status: resp.ok ? 'sent' : 'failed'
  });
}

async function notifyMaddy(subject, details) {
  await sendFreeformWhatsApp(MADDY_PHONE, `ESCALATION: ${subject}\n${details}`);
}

async function logIncoming(phone, body) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body,
    status: 'received'
  });
}

module.exports = {
  sendWhatsApp,
  sendFreeformWhatsApp,
  notifyMaddy,
  logIncoming,
  detectMarket,
  isHinglish,
  maskPhone,
  MADDY_PHONE
};

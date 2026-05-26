const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

async function canSendMessage(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();

  if (client) return true;

  const { count } = await db
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return (count || 0) === 0;
}

async function sendWhatsApp(phone, body, templateName) {
  const allowed = await canSendMessage(phone);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const db = getSupabase();

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName || 'direct_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: [],
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  if (templateName) {
    payload.templateParams = Array.isArray(body) ? body : [body];
  } else {
    payload.message = body;
  }

  let status = 'sent';
  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      status = 'failed';
      console.error(`AiSensy error for ${maskPhone(phone)}: ${res.status}`);
    }
  } catch (err) {
    status = 'failed';
    console.error(`AiSensy send failed for ${maskPhone(phone)}: ${err.message}`);
  }

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: Array.isArray(body) ? body.join(', ') : body,
    template_name: templateName || null,
    sent_at: new Date().toISOString(),
    status
  });

  return { ok: status === 'sent' };
}

async function logInboundMessage(phone, body) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body,
    sent_at: new Date().toISOString(),
    status: 'received'
  });
}

module.exports = { sendWhatsApp, logInboundMessage, maskPhone, detectMarket, canSendMessage };

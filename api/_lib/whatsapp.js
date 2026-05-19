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

async function sendWhatsApp({ phone, templateName, body, params }) {
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

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    media: {}
  };

  if (body && !templateName) {
    payload.message = body;
  }

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || `template:${templateName}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return result;
}

async function logInbound(phone, body) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body
  });
}

module.exports = { sendWhatsApp, logInbound, maskPhone, detectMarket };

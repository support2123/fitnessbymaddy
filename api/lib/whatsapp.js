const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

async function sendWhatsApp({ phone, templateName, body, params }) {
  const db = getSupabase();

  const { data: recent } = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (recent && recent.length > 0) {
    const lastSent = new Date(recent[0].sent_at);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const { data: client } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    if (lastSent > twoHoursAgo && (!client || client.length === 0)) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { rateLimited: true };
    }
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { error: 'API key missing' };
  }

  const payload = {
    apiKey,
    campaignName: templateName || 'direct_message',
    destination: phone.replace(/[^0-9]/g, ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  if (body && !templateName) {
    payload.message = body;
  }

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: body || `[template: ${templateName}]`,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return result;
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: body || `[template: ${templateName}]`,
      template_name: templateName,
      status: 'error'
    });
    return { error: err.message };
  }
}

async function notifyMaddy(reason, details) {
  const maddyPhone = '+917082478374';
  const body = `🚨 Escalation: ${reason}\n${details}`;
  return sendWhatsApp({ phone: maddyPhone, body, templateName: null });
}

module.exports = { sendWhatsApp, notifyMaddy, maskPhone, detectMarket, isHinglish };

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

function isHinglish(market) {
  return market === 'IN';
}

async function canSendMessage(phone) {
  const db = getSupabase();
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

async function sendTemplate(phone, templateName, params) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error(`[WA] No AISENSY_API_KEY set — skipping send to ${maskPhone(phone)}`);
    return { ok: false, error: 'no_api_key' };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await res.json();

    const db = getSupabase();
    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: `Template: ${templateName}`,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok, data: result };
  } catch (err) {
    console.error(`[WA] Send failed to ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendTextMessage(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error(`[WA] No AISENSY_API_KEY set — skipping text to ${maskPhone(phone)}`);
    return { ok: false, error: 'no_api_key' };
  }

  const body = {
    apiKey,
    campaignName: 'text_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message: { text },
    source: 'automation'
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const db = getSupabase();
    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: text.slice(0, 500),
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok };
  } catch (err) {
    console.error(`[WA] Text send failed to ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  maskPhone,
  detectMarket,
  isHinglish,
  canSendMessage,
  sendTemplate,
  sendTextMessage
};

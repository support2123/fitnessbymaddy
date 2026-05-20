const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

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

async function checkRateLimit(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    const lastSent = new Date(data[0].sent_at).getTime();
    if (Date.now() - lastSent < RATE_LIMIT_MS) return false;
  }
  return true;
}

async function sendWhatsApp({ phone, templateName, params = [], bypassRateLimit = false }) {
  if (!bypassRateLimit) {
    const allowed = await checkRateLimit(phone);
    if (!allowed) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { ok: false, reason: 'rate_limited' };
    }
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
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

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: `Template: ${templateName}`,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok, result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function sendFreeformWhatsApp({ phone, message, bypassRateLimit = false }) {
  if (!bypassRateLimit) {
    const allowed = await checkRateLimit(phone);
    if (!allowed) return { ok: false, reason: 'rate_limited' };
  }

  try {
    const res = await fetch(`${AISENSY_API}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: 'freeform_message',
        destination: phone.replace('+', ''),
        userName: 'FitnessByMaddy',
        message,
        source: 'automation'
      })
    });

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: message,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok };
  } catch (err) {
    console.error(`Freeform send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp, detectMarket, maskPhone, checkRateLimit };

const { getSupabase } = require('./supabase');

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
  return phone.replace(/[^0-9]/g, '');
}

async function canSendMessage(phone) {
  const supabase = getSupabase();
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
  const supabase = getSupabase();
  const canSend = await canSendMessage(phone);
  if (!canSend) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { success: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: normalizePhone(phone),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'api',
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
      phone: normalizePhone(phone),
      direction: 'out',
      body: `Template: ${templateName}`,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { success: res.ok, data: result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

async function sendTextMessage(phone, text) {
  const supabase = getSupabase();
  const canSend = await canSendMessage(phone);
  if (!canSend) return { success: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: normalizePhone(phone),
    userName: 'FitnessByMaddy',
    message: { type: 'text', text },
    source: 'api'
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    await supabase.from('messages').insert({
      phone: normalizePhone(phone),
      direction: 'out',
      body: text,
      status: res.ok ? 'sent' : 'failed'
    });

    return { success: res.ok };
  } catch (err) {
    console.error(`Text send failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

async function notifyMaddy(reason, details) {
  const text = `ESCALATION: ${reason}\n${details}`;
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, details]);
  return true;
}

module.exports = {
  sendTemplate,
  sendTextMessage,
  notifyMaddy,
  detectMarket,
  normalizePhone,
  maskPhone,
  canSendMessage,
  MADDY_PHONE
};

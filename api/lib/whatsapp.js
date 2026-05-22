const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
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

async function sendTemplate(phone, templateName, params = []) {
  const db = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;

  const allowed = await canSendMessage(phone);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { success: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey,
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

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: `[template: ${templateName}]`,
      template_name: templateName,
      sent_at: new Date().toISOString(),
      status: res.ok ? 'sent' : 'failed'
    });

    return { success: res.ok, result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: `[template: ${templateName}]`,
      template_name: templateName,
      sent_at: new Date().toISOString(),
      status: 'error'
    });
    return { success: false, error: err.message };
  }
}

async function sendFreeform(phone, message) {
  const db = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;

  const body = {
    apiKey,
    campaignName: 'freeform_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message,
    source: 'automation'
  };

  try {
    const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: message,
      sent_at: new Date().toISOString(),
      status: res.ok ? 'sent' : 'failed'
    });

    return { success: res.ok };
  } catch (err) {
    console.error(`Freeform send failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, error: err.message };
  }
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  const msg = `🚨 ESCALATION: ${subject}\n\n${details}`;
  return sendFreeform(maddyPhone, msg);
}

module.exports = { sendTemplate, sendFreeform, notifyMaddy, detectMarket, maskPhone, canSendMessage };

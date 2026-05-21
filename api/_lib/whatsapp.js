const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

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
  const allowed = await canSendMessage(phone);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
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
    console.error(`WA send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function sendTextMessage(phone, text) {
  const allowed = await canSendMessage(phone);
  if (!allowed) {
    return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: text,
    source: 'automation'
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: text,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok };
  } catch (err) {
    console.error(`WA text failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

module.exports = { sendTemplate, sendTextMessage, maskPhone, canSendMessage };

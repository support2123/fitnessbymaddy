const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

async function canSend(phone, isClient) {
  if (isClient) return true;
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);
  if (!data || data.length === 0) return true;
  return Date.now() - new Date(data[0].sent_at).getTime() > RATE_LIMIT_MS;
}

async function sendTemplate(phone, templateName, params = []) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.AISENSY_API_KEY}`
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params,
      source: 'automation'
    })
  });
  return res.json();
}

async function sendText(phone, text) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.AISENSY_API_KEY}`
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: text,
      source: 'automation'
    })
  });
  return res.json();
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body: body || templateName,
    template_name: templateName,
    sent_at: new Date().toISOString()
  });
}

async function sendWhatsApp(phone, { template, text, params = [], isClient = false }) {
  const allowed = await canSend(phone, isClient);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  let result;
  if (template) {
    result = await sendTemplate(phone, template, params);
    await logMessage(phone, 'out', null, template);
  } else if (text) {
    result = await sendText(phone, text);
    await logMessage(phone, 'out', text, null);
  }

  return { ok: true, result };
}

module.exports = { sendWhatsApp, logMessage, maskPhone, canSend };

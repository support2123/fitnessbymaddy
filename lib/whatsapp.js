const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
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
  const db = getSupabase();

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params || []
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: params ? params.join(' | ') : templateName,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return result;
}

async function sendText(phone, body) {
  const db = getSupabase();

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: body
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body,
    status: res.ok ? 'sent' : 'failed'
  });
}

module.exports = { sendTemplate, sendText, canSendMessage, maskPhone };

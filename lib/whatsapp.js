const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params = []) {
  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params,
    }),
  });
  const data = await resp.json();

  await logMessage(phone, 'out', `[template:${templateName}] ${params.join(', ')}`, templateName);
  return data;
}

async function sendText(phone, body) {
  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: body,
    }),
  });
  const data = await resp.json();

  await logMessage(phone, 'out', body, null);
  return data;
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone: maskPhone(phone),
    direction,
    body: body?.substring(0, 2000),
    template_name: templateName,
  });
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return phone;
  return phone.substring(0, 4) + 'XXX...' + phone.substring(phone.length - 3);
}

async function canSendMessage(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  if (client) return true;

  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('phone', maskPhone(phone))
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return (count || 0) === 0;
}

module.exports = { sendTemplate, sendText, logMessage, maskPhone, canSendMessage };

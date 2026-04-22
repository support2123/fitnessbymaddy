const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params) {
  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params || [],
    }),
  });

  const data = await res.json();

  await logMessage(phone, 'out', params ? params.join(' | ') : templateName, templateName);

  return data;
}

async function sendText(phone, text) {
  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: text,
    }),
  });

  const data = await res.json();
  await logMessage(phone, 'out', text, null);
  return data;
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body ? body.substring(0, 2000) : null,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
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

  if (data && data.length > 0) {
    const { data: clientData } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    return clientData && clientData.length > 0;
  }

  return true;
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.substring(0, 3) + 'XXX...' + phone.substring(phone.length - 3);
}

module.exports = { sendTemplate, sendText, logMessage, canSendMessage, maskPhone };

const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params = []) {
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
      templateParams: params,
    }),
  });

  const data = await res.json();

  await logMessage(phone, 'out', params.join(' | ') || templateName, templateName);

  return data;
}

async function sendText(phone, message) {
  const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: message,
    }),
  });

  const data = await res.json();

  await logMessage(phone, 'out', message, null);

  return data;
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  const masked = maskPhone(phone);
  await db.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
  });
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

async function canSendMessage(phone) {
  const db = getSupabase();

  const { data: lead } = await db
    .from('leads')
    .select('opted_out, status')
    .eq('phone', phone)
    .single();

  if (lead?.opted_out || lead?.status === 'dropped') return false;

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  if (client) return true;

  return (count || 0) < 1;
}

module.exports = { sendTemplate, sendText, logMessage, maskPhone, canSendMessage };

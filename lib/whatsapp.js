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
  return data;
}

async function sendText(phone, message) {
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
      message: message,
    }),
  });
  const data = await res.json();
  return data;
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body || templateName,
    template_name: templateName || null,
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

  const isClient = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  if (isClient.data && isClient.data.length > 0) return true;
  return !data || data.length === 0;
}

async function sendRateLimited(phone, templateName, params, bodyForLog) {
  const allowed = await canSendMessage(phone);
  if (!allowed) {
    return { success: false, reason: 'rate_limited' };
  }

  const result = await sendTemplate(phone, templateName, params);
  await logMessage(phone, 'out', bodyForLog || templateName, templateName);
  return { success: true, result };
}

module.exports = {
  sendTemplate,
  sendText,
  logMessage,
  canSendMessage,
  sendRateLimited,
};

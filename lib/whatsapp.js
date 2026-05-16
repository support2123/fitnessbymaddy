const { supabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

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
  await logMessage(phone, 'out', params.join(' | '), templateName);
  return data;
}

async function sendText(phone, body) {
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
      message: body,
    }),
  });
  const data = await res.json();
  await logMessage(phone, 'out', body, 'text_message');
  return data;
}

async function checkRateLimit(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return true;

  const lastSent = new Date(data[0].sent_at).getTime();
  return Date.now() - lastSent >= RATE_LIMIT_MS;
}

async function sendRateLimited(phone, templateName, params = [], isClient = false) {
  if (!isClient) {
    const canSend = await checkRateLimit(phone);
    if (!canSend) return { skipped: true, reason: 'rate_limited' };
  }
  return sendTemplate(phone, templateName, params);
}

async function logMessage(phone, direction, body, templateName = null) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body: body || '',
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

module.exports = {
  sendTemplate,
  sendText,
  sendRateLimited,
  checkRateLimit,
  logMessage,
};

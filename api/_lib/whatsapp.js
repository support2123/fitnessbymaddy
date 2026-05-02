const { supabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendToPhone(phone, isClient) {
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

async function sendTemplate(phone, templateName, params, userName) {
  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: userName || 'there',
      templateParams: params || [],
    }),
  });
  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[template: ${templateName}] ${(params || []).join(', ')}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return result;
}

async function sendSessionMessage(phone, body) {
  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'session_message',
      destination: phone,
      userName: 'there',
      message: body,
    }),
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body,
    status: res.ok ? 'sent' : 'failed',
  });

  return res.json();
}

async function sendWhatsAppWithRateLimit(phone, templateName, params, userName, isClient) {
  const allowed = await canSendToPhone(phone, isClient);
  if (!allowed) {
    return { ok: false, reason: 'rate_limited' };
  }
  return sendTemplate(phone, templateName, params, userName);
}

module.exports = {
  sendTemplate,
  sendSessionMessage,
  sendWhatsAppWithRateLimit,
  canSendToPhone,
};

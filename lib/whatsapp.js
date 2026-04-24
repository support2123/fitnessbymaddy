const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendMessage(phone, isClient) {
  if (isClient) return true;

  const db = getSupabase();
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);

  return !data || data.length === 0;
}

async function sendTemplate(phone, templateName, params) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const allowed = await canSendMessage(phone, false);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { sent: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/\D/g, ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    buttons: params.buttons || [],
    media: params.media || {}
  };

  const resp = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await resp.json();

  await logMessage(phone, 'out', params.templateParams?.[0] || templateName, templateName);

  return { sent: true, result };
}

async function sendText(phone, text, isClient) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const allowed = await canSendMessage(phone, isClient);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { sent: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey,
    campaignName: 'text_message',
    destination: phone.replace(/\D/g, ''),
    message: text
  };

  const resp = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await resp.json();
  await logMessage(phone, 'out', text, null);

  return { sent: true, result };
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body?.slice(0, 500),
    template_name: templateName,
    sent_at: new Date().toISOString()
  });
}

module.exports = { sendTemplate, sendText, logMessage, canSendMessage };

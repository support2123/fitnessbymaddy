const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_BASE = 'https://backend.aisensy.com';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSend(phone, isClient) {
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

async function sendTemplate(phone, templateName, params, userName) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const res = await fetch(`${AISENSY_BASE}/campaign/t1/api/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: templateName,
      destination: phone.replace(/[^0-9]/g, ''),
      userName: userName || 'there',
      templateParams: params || []
    })
  });

  const result = await res.json();
  await logMessage(phone, 'out', `[template:${templateName}] ${(params || []).join(', ')}`, templateName);
  return result;
}

async function sendText(phone, message) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const res = await fetch(`${AISENSY_BASE}/direct/t1/api/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: 'direct_message',
      destination: phone.replace(/[^0-9]/g, ''),
      message
    })
  });

  const result = await res.json();
  await logMessage(phone, 'out', message, null);
  return result;
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body ? body.slice(0, 2000) : '',
    template_name: templateName,
    sent_at: new Date().toISOString()
  });
}

async function sendRateLimited(phone, templateName, params, userName, isClient) {
  const allowed = await canSend(phone, isClient);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { success: false, reason: 'rate_limited' };
  }
  const result = await sendTemplate(phone, templateName, params, userName);
  return { success: true, result };
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  const msg = `🚨 ESCALATION: ${subject}\n${details}`;
  try {
    await sendText(maddyPhone, msg);
  } catch (err) {
    console.error('Failed to notify Maddy:', err.message);
  }
}

module.exports = {
  sendTemplate,
  sendText,
  sendRateLimited,
  logMessage,
  canSend,
  notifyMaddy
};

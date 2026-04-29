const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '917082478374';

async function canSendMessage(phone, isClient) {
  if (isClient) return true;
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

async function sendTemplate(phone, templateName, params, userName) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/[^0-9]/g, ''),
    userName: userName || 'there',
    templateParams: params || [],
    source: 'automation',
    media: {},
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();

  await logMessage(phone, 'out', `[template:${templateName}] ${(params || []).join(', ')}`, templateName);

  return result;
}

async function sendText(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const body = {
    apiKey,
    campaignName: 'session_text',
    destination: phone.replace(/[^0-9]/g, ''),
    userName: 'there',
    templateParams: [text],
    source: 'automation',
    media: {},
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();
  await logMessage(phone, 'out', text, null);
  return result;
}

async function notifyMaddy(subject, details) {
  try {
    await sendTemplate(MADDY_PHONE, 'admin_alert', [subject, details], 'Maddy');
  } catch (err) {
    console.error('Failed to notify Maddy:', err.message);
  }
}

async function logMessage(phone, direction, body, templateName) {
  try {
    const db = getSupabase();
    await db.from('messages').insert({
      phone,
      direction,
      body: body ? body.slice(0, 2000) : null,
      template_name: templateName,
    });
  } catch (err) {
    console.error('Message log failed for', maskPhone(phone), err.message);
  }
}

module.exports = { canSendMessage, sendTemplate, sendText, notifyMaddy, logMessage };

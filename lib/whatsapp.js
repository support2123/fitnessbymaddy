const { getClient } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

async function canSend(phone, isClient) {
  if (isClient) return true;
  const db = getClient();
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { count } = await db
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff);
  return (count || 0) === 0;
}

async function sendTemplate(phone, templateName, params) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    media: params.media || {},
    buttons: params.buttons || []
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();
  return result;
}

async function sendMessage(phone, text, options = {}) {
  const { templateName, isClient, params } = options;
  const db = getClient();

  if (!await canSend(phone, isClient)) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { rateLimited: true };
  }

  let result;
  if (templateName) {
    result = await sendTemplate(phone, templateName, params || {});
  } else {
    result = await sendTemplate(phone, 'session_message', {
      templateParams: [text],
      ...params
    });
  }

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: text || templateName,
    template_name: templateName || null,
    status: result.success === false ? 'failed' : 'sent'
  });

  return result;
}

async function logIncoming(phone, body) {
  const db = getClient();
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body,
    status: 'received'
  });
}

module.exports = { sendMessage, logIncoming, maskPhone, canSend };

const supabase = require('./supabase');

const AISENSY_API_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendWhatsApp(phone, body, templateName, skipRateLimit) {
  if (!skipRateLimit) {
    const isLimited = await isRateLimited(phone);
    if (isLimited) return { sent: false, reason: 'rate_limited' };
  }

  const isOptedOut = await checkOptOut(phone);
  if (isOptedOut) return { sent: false, reason: 'opted_out' };

  const payload = templateName
    ? buildTemplatePayload(phone, templateName, body)
    : buildTextPayload(phone, body);

  const res = await fetch(AISENSY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AiSensy-Project-API-Pwd': process.env.AISENSY_API_KEY
    },
    body: JSON.stringify(payload)
  });

  const status = res.ok ? 'sent' : 'failed';

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: body || templateName,
    template_name: templateName,
    status
  });

  return { sent: res.ok, status };
}

function buildTemplatePayload(phone, templateName, params) {
  return {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: Array.isArray(params) ? params : params ? [params] : [],
    source: 'automation'
  };
}

function buildTextPayload(phone, body) {
  return {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: { text: body },
    source: 'automation'
  };
}

async function isRateLimited(phone) {
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);

  return data && data.length > 0;
}

async function checkOptOut(phone) {
  const { data } = await supabase
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .eq('status', 'dropped')
    .limit(1);

  return data && data.length > 0;
}

async function logIncoming(phone, body) {
  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body
  });
}

module.exports = { sendWhatsApp, logIncoming, checkOptOut };

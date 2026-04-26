const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '+917082478374';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendTemplate(phone, templateName, params = []) {
  const rateLimited = await isRateLimited(phone);
  if (rateLimited) {
    console.log(`Rate-limited: skipping ${templateName} to ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json().catch(() => ({}));

  await logMessage(phone, 'out', `[template:${templateName}] ${params.join(', ')}`, templateName);

  return { ok: res.ok, data: result };
}

async function sendText(phone, text) {
  const rateLimited = await isRateLimited(phone);
  if (rateLimited) {
    console.log(`Rate-limited: skipping text to ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_reply',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message: { type: 'text', text },
    source: 'automation'
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  await logMessage(phone, 'out', text, null);
  return { ok: res.ok };
}

async function sendMediaMessage(phone, mediaUrl, caption) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'media_send',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    media: { url: mediaUrl, filename: 'program.pdf' },
    message: { type: 'document', text: caption || '' },
    source: 'automation'
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  await logMessage(phone, 'out', `[document] ${caption || mediaUrl}`, null);
  return { ok: res.ok };
}

async function notifyMaddy(subject, details) {
  await sendText(MADDY_PHONE, `🚨 ESCALATION: ${subject}\n\n${details}`);
}

async function isRateLimited(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', new Date(Date.now() - RATE_LIMIT_MS).toISOString())
    .order('sent_at', { ascending: false })
    .limit(1);

  return data && data.length > 0;
}

async function isRateLimitedForLead(phone) {
  return isRateLimited(phone);
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
    sent_at: new Date().toISOString()
  });
}

module.exports = {
  sendTemplate,
  sendText,
  sendMediaMessage,
  notifyMaddy,
  isRateLimited,
  isRateLimitedForLead,
  logMessage,
  MADDY_PHONE
};

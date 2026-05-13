const { getSupabase } = require('./supabase');
const { maskPhone } = require('./escalation');

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';
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

async function sendTemplate(phone, templateName, params = [], mediaUrl) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'Fitness by Maddy',
    templateParams: params,
    source: 'api',
    media: mediaUrl ? { url: mediaUrl, filename: 'program.pdf' } : {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();

  await logMessage(phone, 'out', `[template:${templateName}] ${params.join(', ')}`, templateName);

  if (!res.ok) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, result);
  }

  return { ok: res.ok, result };
}

async function sendText(phone, message) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'Fitness by Maddy',
    message: message,
    source: 'api'
  };

  const res = await fetch('https://backend.aisensy.com/direct/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();
  await logMessage(phone, 'out', message, null);

  return { ok: res.ok, result };
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

async function notifyMaddy(subject, details) {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  await resend.emails.send({
    from: 'FitnessByMaddy Bot <support@fitnessbymaddy.com>',
    to: 'maddy@fitnessbymaddy.com',
    subject: `[ESCALATION] ${subject}`,
    text: details
  });

  try {
    await sendTemplate(process.env.MADDY_PHONE || '917082478374', 'escalation_alert', [subject]);
  } catch (_) {
    // email already sent as primary notification
  }
}

module.exports = { sendTemplate, sendText, canSendMessage, logMessage, notifyMaddy };

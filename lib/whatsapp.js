const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const AISENSY_KEY = process.env.AISENSY_API_KEY;
const BUSINESS_PHONE = '+917082478374';

async function canSendMessage(phone, isClient) {
  if (isClient) return true;
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);
  return (count || 0) === 0;
}

async function sendTemplate(phone, templateName, params = []) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: AISENSY_KEY,
      campaignName: templateName,
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      templateParams: params,
    }),
  });
  const data = await res.json();
  await logMessage(phone, 'out', params.join(' | '), templateName);
  return data;
}

async function sendTextMessage(phone, text) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: AISENSY_KEY,
      campaignName: 'text_message',
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      message: { text },
    }),
  });
  const data = await res.json();
  await logMessage(phone, 'out', text, null);
  return data;
}

async function sendMediaMessage(phone, text, mediaUrl) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: AISENSY_KEY,
      campaignName: 'media_message',
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      message: { text },
      media: { url: mediaUrl },
    }),
  });
  const data = await res.json();
  await logMessage(phone, 'out', text, null);
  return data;
}

async function logMessage(phone, direction, body, templateName) {
  const masked = maskPhone(phone);
  await supabase.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

module.exports = {
  sendTemplate,
  sendTextMessage,
  sendMediaMessage,
  canSendMessage,
  logMessage,
  maskPhone,
  BUSINESS_PHONE,
};

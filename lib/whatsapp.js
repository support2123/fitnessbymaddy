const { supabase } = require('./supabase');

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

async function canSendMessage(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return true;

  const lastSent = new Date(data[0].sent_at);
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  return lastSent < twoHoursAgo;
}

async function sendTemplate(phone, templateName, params) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[template: ${templateName}]`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok, result };
}

async function sendTextMessage(phone, text) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: text,
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok };
}

module.exports = { sendTemplate, sendTextMessage, canSendMessage, maskPhone };

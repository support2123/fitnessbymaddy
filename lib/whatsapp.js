const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
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
  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      templateParams: params,
      source: 'automation',
      media: {},
      buttons: [],
      carouselCards: [],
      location: {},
    }),
  });

  const result = await resp.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[template: ${templateName}] ${params.join(', ')}`,
    template_name: templateName,
    status: resp.ok ? 'sent' : 'failed',
  });

  return result;
}

async function sendText(phone, text) {
  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      message: text,
      source: 'automation',
    }),
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: resp.ok ? 'sent' : 'failed',
  });

  return resp.json();
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

module.exports = { sendTemplate, sendText, canSendMessage, maskPhone, BUSINESS_PHONE };

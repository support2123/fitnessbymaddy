const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '917082478374';

async function sendTemplate(phone, templateName, params = [], market = 'IN') {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.AISENSY_API_KEY}`
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params,
      source: 'automation',
      media: {},
      buttons: [],
      carouselCards: [],
      location: {}
    })
  });

  const data = await res.json();

  await logMessage(phone, 'out', `[template: ${templateName}] ${params.join(', ')}`, templateName);

  return data;
}

async function sendText(phone, text) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.AISENSY_API_KEY}`
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: [text],
      source: 'automation',
      media: {}
    })
  });

  const data = await res.json();
  await logMessage(phone, 'out', text, null);
  return data;
}

async function sendMediaTemplate(phone, templateName, params, mediaUrl) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.AISENSY_API_KEY}`
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params,
      source: 'automation',
      media: { url: mediaUrl, filename: 'program.pdf' },
      buttons: [],
      carouselCards: [],
      location: {}
    })
  });

  const data = await res.json();
  await logMessage(phone, 'out', `[template: ${templateName}] + PDF`, templateName);
  return data;
}

async function notifyMaddy(reason, context) {
  const maskedContext = context ? maskPhone(context) : '';
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, maskedContext]);
}

async function checkRateLimit(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return data && data.length > 0;
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body ? body.substring(0, 2000) : null,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

function maskPhone(text) {
  return text.replace(/(\+?\d{2,3})\d+(\d{3})/g, '$1XXX...$2');
}

module.exports = {
  sendTemplate,
  sendText,
  sendMediaTemplate,
  notifyMaddy,
  checkRateLimit,
  logMessage,
  maskPhone,
  MADDY_PHONE
};

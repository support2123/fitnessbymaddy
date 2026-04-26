const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '+917082478374';

async function sendTemplate(phone, templateName, params = []) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      templateParams: params,
      source: 'automation'
    })
  });

  const data = await res.json();

  await logMessage(phone, 'out', `[template: ${templateName}]`, templateName);

  if (!res.ok) {
    console.error(`WA send failed to ${maskPhone(phone)}:`, data);
  }

  return data;
}

async function sendSession(phone, message) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'session_message',
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      message: { text: message },
      source: 'automation'
    })
  });

  const data = await res.json();

  await logMessage(phone, 'out', message, null);

  return data;
}

async function sendMediaMessage(phone, mediaUrl, caption) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'media_message',
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      media: { url: mediaUrl, filename: 'program.pdf' },
      message: { text: caption || '' },
      source: 'automation'
    })
  });

  const data = await res.json();

  await logMessage(phone, 'out', `[PDF: ${caption || 'program'}]`, null);

  return data;
}

async function notifyMaddy(subject, details) {
  await sendSession(MADDY_PHONE, `*ALERT: ${subject}*\n\n${details}`);
}

async function logMessage(phone, direction, body, templateName) {
  try {
    await supabase.from('messages').insert({
      phone,
      direction,
      body: body ? body.slice(0, 2000) : null,
      template_name: templateName
    });
  } catch (e) {
    console.error('Failed to log message for', maskPhone(phone));
  }
}

async function canSendMessage(phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  if (client && client.length > 0) return true;

  return !data || data.length === 0;
}

module.exports = {
  sendTemplate,
  sendSession,
  sendMediaMessage,
  notifyMaddy,
  logMessage,
  canSendMessage,
  MADDY_PHONE
};

const { supabase } = require('./supabase');
const { maskPhone } = require('./utils');

const AISENSY_BASE = 'https://backend.aisensy.com';

async function canSendMessage(phone, isClient) {
  if (isClient) return true;

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return !data || data.length === 0;
}

async function sendTemplate(phone, templateName, params = [], mediaUrl = null) {
  const allowed = await canSendMessage(phone, false);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { success: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params
  };

  if (mediaUrl) {
    payload.mediaUrl = mediaUrl;
    payload.mediaFilename = 'program.pdf';
  }

  const res = await fetch(`${AISENSY_BASE}/campaign/t1/api/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  await logMessage(phone, 'out', `[template:${templateName}] ${params.join(', ')}`, templateName);

  return { success: res.ok, data: result };
}

async function sendText(phone, message, isClient = false) {
  const allowed = await canSendMessage(phone, isClient);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { success: false, reason: 'rate_limited' };
  }

  const res = await fetch(`${AISENSY_BASE}/campaign/t1/api/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'direct_text',
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      templateParams: [message]
    })
  });

  const result = await res.json();

  await logMessage(phone, 'out', message, null);

  return { success: res.ok, data: result };
}

async function sendDocument(phone, documentUrl, caption, isClient = true) {
  const res = await fetch(`${AISENSY_BASE}/campaign/t1/api/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'program_delivery',
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      templateParams: [caption],
      mediaUrl: documentUrl,
      mediaFilename: 'program.pdf'
    })
  });

  const result = await res.json();
  await logMessage(phone, 'out', `[PDF] ${caption}`, 'program_delivery');

  return { success: res.ok, data: result };
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  const msg = `🚨 ${subject}\n${details}`;

  await fetch(`${AISENSY_BASE}/campaign/t1/api/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'admin_alert',
      destination: maddyPhone.replace('+', ''),
      userName: 'FitnessByMaddy',
      templateParams: [subject, details]
    })
  });
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body: body?.slice(0, 2000),
    template_name: templateName,
    sent_at: new Date().toISOString()
  });
}

module.exports = { sendTemplate, sendText, sendDocument, notifyMaddy, logMessage };

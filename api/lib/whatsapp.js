const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, bodyParams, mediaUrl) {
  const rateLimited = await checkRateLimit(phone);
  if (rateLimited) {
    console.log(`Rate limited: ${phone.slice(0, 3)}XXX...${phone.slice(-3)}`);
    return { sent: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: bodyParams || [],
  };
  if (mediaUrl) {
    payload.mediaUrl = mediaUrl;
    payload.mediaFilename = 'program.pdf';
  }

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  await logMessage(phone, 'out', templateName, bodyParams, data.status || 'sent');

  return { sent: true, data };
}

async function sendFreeformWhatsApp(phone, message) {
  const rateLimited = await checkRateLimit(phone);
  if (rateLimited) return { sent: false, reason: 'rate_limited' };

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_reply',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message,
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  await logMessage(phone, 'out', 'freeform', [message], data.status || 'sent');

  return { sent: true, data };
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

async function logMessage(phone, direction, templateName, bodyParams, status) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: Array.isArray(bodyParams) ? bodyParams.join(' | ') : (bodyParams || ''),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: status || 'sent',
  });
}

async function notifyMaddy(subject, details) {
  const maddyPhone = '+917082478374';
  const msg = `🚨 ESCALATION: ${subject}\n\n${details}`;

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'admin_alert',
    destination: maddyPhone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: [subject, details],
  };

  try {
    await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('Failed to notify Maddy:', err.message);
  }
}

module.exports = {
  sendWhatsApp,
  sendFreeformWhatsApp,
  checkRateLimit,
  logMessage,
  notifyMaddy,
};

const { supabase } = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendWhatsApp({ phone, templateName, bodyValues, mediaUrl }) {
  const canSend = await checkRateLimit(phone);
  if (!canSend) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: bodyValues || [],
  };

  if (mediaUrl) {
    payload.mediaUrl = mediaUrl;
    payload.mediaFilename = 'program.pdf';
  }

  try {
    const resp = await fetch(`${AISENSY_API}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();

    await logMessage({
      phone,
      direction: 'out',
      body: bodyValues ? bodyValues.join(' | ') : templateName,
      template_name: templateName,
      status: resp.ok ? 'sent' : 'failed'
    });

    return { ok: resp.ok, data };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function sendFreeformWhatsApp({ phone, message }) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_reply',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message
  };

  try {
    const resp = await fetch(`${AISENSY_API}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    await logMessage({
      phone,
      direction: 'out',
      body: message,
      template_name: null,
      status: resp.ok ? 'sent' : 'failed'
    });

    return { ok: resp.ok };
  } catch (err) {
    console.error(`WhatsApp freeform failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function checkRateLimit(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return true;
  const lastSent = new Date(data[0].sent_at).getTime();
  return Date.now() - lastSent >= RATE_LIMIT_MS;
}

async function logMessage({ phone, direction, body, template_name, status }) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body,
    template_name,
    status
  });
}

async function notifyMaddy(subject, details) {
  const phone = '+917082478374';
  await sendWhatsApp({
    phone,
    templateName: 'escalation_alert',
    bodyValues: [subject, details]
  });
}

module.exports = {
  sendWhatsApp,
  sendFreeformWhatsApp,
  checkRateLimit,
  logMessage,
  notifyMaddy
};

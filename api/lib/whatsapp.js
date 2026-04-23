const { getSupabase } = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '+917082478374';

async function canSendToLead(phone) {
  const sb = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);
  return !data || data.length === 0;
}

async function sendTemplate(phone, templateName, params = []) {
  const sb = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
    media: {}
  };

  let status = 'sent';
  try {
    const resp = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      status = 'failed';
      console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, resp.status);
    }
  } catch (err) {
    status = 'failed';
    console.error(`WhatsApp send error for ${maskPhone(phone)}:`, err.message);
  }

  await sb.from('messages').insert({
    phone,
    direction: 'out',
    body: `[Template: ${templateName}] ${params.join(', ')}`,
    template_name: templateName,
    status
  });

  return status;
}

async function sendText(phone, text) {
  const sb = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;

  const payload = {
    apiKey,
    campaignName: 'text_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message: { text },
    source: 'automation'
  };

  let status = 'sent';
  try {
    const resp = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) status = 'failed';
  } catch {
    status = 'failed';
  }

  await sb.from('messages').insert({
    phone, direction: 'out', body: text, status
  });

  return status;
}

async function notifyMaddy(subject, details) {
  await sendText(MADDY_PHONE, `ALERT: ${subject}\n${details}`);
}

async function logIncoming(phone, body) {
  const sb = getSupabase();
  await sb.from('messages').insert({
    phone, direction: 'in', body, status: 'received'
  });
}

module.exports = { canSendToLead, sendTemplate, sendText, notifyMaddy, logIncoming, MADDY_PHONE };

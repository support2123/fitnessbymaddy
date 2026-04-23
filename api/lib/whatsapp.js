const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, body, templateName = null) {
  const headers = {
    'Content-Type': 'application/json',
  };

  const payload = templateName
    ? {
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: templateName,
        destination: phone,
        userName: 'FitnessByMaddy',
        templateParams: Array.isArray(body) ? body : [body],
      }
    : {
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: 'session_reply',
        destination: phone,
        userName: 'FitnessByMaddy',
        message: body,
      };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone: phone,
    direction: 'out',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return result;
}

async function sendEscalation(message) {
  const MADDY_PHONE = '917082478374';
  return sendWhatsApp(MADDY_PHONE, message, 'escalation_alert');
}

module.exports = { sendWhatsApp, sendEscalation };

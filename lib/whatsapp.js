const { supabase } = require('./supabase');
const { maskPhone } = require('./utils');

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params = []) {
  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.AISENSY_API_KEY}`
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: params[0] || 'there',
      templateParams: params,
      source: 'fitnessbymaddy-automation',
      buttons: [],
      carouselCards: [],
      location: {}
    })
  });

  const data = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `Template: ${templateName}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  if (!res.ok) {
    console.error(`WhatsApp send failed to ${maskPhone(phone)}:`, data);
  }

  return { ok: res.ok, data };
}

async function sendText(phone, text) {
  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.AISENSY_API_KEY}`
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone,
      userName: 'there',
      templateParams: [text],
      source: 'fitnessbymaddy-automation'
    })
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok };
}

async function notifyMaddy(subject, details) {
  const adminPhone = process.env.MADDY_PHONE || '+917082478374';
  await sendText(adminPhone, `ESCALATION: ${subject}\n${details}`);
}

module.exports = { sendTemplate, sendText, notifyMaddy };

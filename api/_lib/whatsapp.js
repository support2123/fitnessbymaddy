const AISENSY_API_KEY = process.env.AISENSY_API_KEY;
const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

const { maskPhone } = require('./utils');

async function sendTemplate(phone, templateName, params = [], userName = 'there') {
  const body = {
    apiKey: AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName,
    templateParams: params,
  };

  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();
  if (!res.ok) {
    console.error(`WhatsApp send failed to ${maskPhone(phone)}: ${JSON.stringify(result)}`);
    throw new Error(`AiSensy error: ${res.status}`);
  }

  return result;
}

async function sendText(phone, message) {
  return sendTemplate(phone, 'text_message', [message]);
}

async function sendMediaTemplate(phone, templateName, mediaUrl, params = [], userName = 'there') {
  const body = {
    apiKey: AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName,
    templateParams: params,
    media: { url: mediaUrl, filename: 'program.pdf' },
  };

  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();
  if (!res.ok) {
    console.error(`WhatsApp media send failed to ${maskPhone(phone)}: ${JSON.stringify(result)}`);
    throw new Error(`AiSensy media error: ${res.status}`);
  }

  return result;
}

module.exports = { sendTemplate, sendText, sendMediaTemplate };

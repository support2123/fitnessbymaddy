const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendTemplate(phone, templateName, params = []) {
  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AiSensy error ${res.status}: ${text}`);
  }

  return res.json();
}

async function sendText(phone, message) {
  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: message,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AiSensy error ${res.status}: ${text}`);
  }

  return res.json();
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

module.exports = { sendTemplate, sendText, maskPhone, RATE_LIMIT_MS };

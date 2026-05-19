const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

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

  const data = await res.json();
  return { ok: res.ok, data };
}

async function sendTextMessage(phone, message) {
  const res = await fetch('https://backend.aisensy.com/direct-apis/t1/api/v2/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      to: phone,
      type: 'text',
      text: { body: message },
    }),
  });

  const data = await res.json();
  return { ok: res.ok, data };
}

module.exports = { sendTemplate, sendTextMessage };

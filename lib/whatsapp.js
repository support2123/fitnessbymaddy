const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

async function sendTemplate(phone, templateName, params = []) {
  const res = await fetch(AISENSY_API, {
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
    console.error(`WhatsApp send failed for ${maskPhone(phone)}: ${text}`);
    return { ok: false, error: text };
  }

  return { ok: true };
}

async function sendText(phone, message) {
  const res = await fetch(AISENSY_API, {
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
    console.error(`WhatsApp text failed for ${maskPhone(phone)}: ${text}`);
    return { ok: false, error: text };
  }

  return { ok: true };
}

module.exports = { sendTemplate, sendText, maskPhone };

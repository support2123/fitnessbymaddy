const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
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
      destination: phone.replace(/^\+/, ''),
      userName: 'FitnessByMaddy',
      templateParams: params,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`WhatsApp send failed for ${maskPhone(phone)}: ${text}`);
    return { success: false, error: text };
  }

  return { success: true };
}

async function sendFreeform(phone, message) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'freeform_message',
      destination: phone.replace(/^\+/, ''),
      userName: 'FitnessByMaddy',
      message: message,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`WhatsApp freeform failed for ${maskPhone(phone)}: ${text}`);
    return { success: false, error: text };
  }

  return { success: true };
}

module.exports = { sendTemplate, sendFreeform, maskPhone, detectMarket, isHinglish };

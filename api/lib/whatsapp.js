const AISENSY_API_KEY = process.env.AISENSY_API_KEY;
const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

export function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

export function detectMarket(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

export async function sendTemplate(phone, templateName, params = []) {
  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      templateParams: params,
    }),
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

export async function sendTextMessage(phone, message) {
  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      message,
    }),
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

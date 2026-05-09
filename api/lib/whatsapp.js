const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
  if (cleaned.length === 10) cleaned = '91' + cleaned;
  return cleaned;
}

async function sendTemplate(phone, templateName, params) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const body = {
    apiKey,
    campaignName: templateName,
    destination: normalizePhone(phone),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, data);
    throw new Error(`WhatsApp send failed: ${data.message || res.status}`);
  }
  return data;
}

async function sendTextMessage(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const body = {
    apiKey,
    campaignName: 'text_message',
    destination: normalizePhone(phone),
    userName: 'FitnessByMaddy',
    message: text,
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return res.json();
}

module.exports = { sendTemplate, sendTextMessage, maskPhone, detectMarket, normalizePhone };

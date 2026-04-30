const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

async function sendWhatsApp({ phone, templateName, params = [], body = null }) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const payload = body
    ? {
        apiKey,
        campaignName: templateName || 'direct_message',
        destination: phone,
        userName: 'FitnessByMaddy',
        message: body,
      }
    : {
        apiKey,
        campaignName: templateName,
        destination: phone,
        userName: 'FitnessByMaddy',
        templateParams: params,
      };

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error(`WhatsApp send failed to ${maskPhone(phone)}:`, data);
  }
  return { ok: res.ok, data };
}

async function sendTemplate(phone, templateName, params = []) {
  return sendWhatsApp({ phone, templateName, params });
}

async function sendText(phone, body) {
  return sendWhatsApp({ phone, body, templateName: 'direct_message' });
}

module.exports = { sendWhatsApp, sendTemplate, sendText, maskPhone };

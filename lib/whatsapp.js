const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const clean = phone.replace(/[^0-9+]/g, '');
  if (clean.startsWith('+91') || clean.startsWith('91')) return 'IN';
  if (clean.startsWith('+971') || clean.startsWith('971')) return 'UAE';
  if (clean.startsWith('+44') || clean.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

async function sendTemplate(phone, templateName, params) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('[WA] AISENSY_API_KEY not set');
    return { ok: false, error: 'API key missing' };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/[^0-9]/g, ''),
    userName: params?.name || 'there',
    templateParams: params?.templateParams || [],
    source: 'automation',
    media: params?.media || undefined,
    buttons: params?.buttons || undefined
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (err) {
    console.error(`[WA] Send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendText(phone, message) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('[WA] AISENSY_API_KEY not set');
    return { ok: false, error: 'API key missing' };
  }

  const body = {
    apiKey,
    campaignName: 'text_message',
    destination: phone.replace(/[^0-9]/g, ''),
    message,
    source: 'automation'
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (err) {
    console.error(`[WA] Text send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendTemplate, sendText, maskPhone, detectMarket, isHinglish };

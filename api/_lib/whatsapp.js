const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_WINDOW_MS = 2 * 60 * 60 * 1000;

const recentSends = new Map();

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function isRateLimited(phone, isClient) {
  if (isClient) return false;
  const last = recentSends.get(phone);
  if (last && Date.now() - last < RATE_WINDOW_MS) return true;
  return false;
}

function recordSend(phone) {
  recentSends.set(phone, Date.now());
}

export async function sendTemplate(phone, templateName, params = []) {
  if (isRateLimited(phone, false)) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  recordSend(phone);
  return { ok: res.ok, data };
}

export async function sendText(phone, message) {
  if (isRateLimited(phone, false)) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message,
    source: 'automation'
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  recordSend(phone);
  return { ok: res.ok, data };
}

export async function sendClientMessage(phone, templateName, params = []) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  return { ok: res.ok, data };
}

export { maskPhone };

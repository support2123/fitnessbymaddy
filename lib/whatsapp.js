const { logMessage } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

const lastSentTimestamps = new Map();

async function sendTemplate(phone, templateName, params = []) {
  const now = Date.now();
  const lastSent = lastSentTimestamps.get(phone) || 0;
  const twoHours = 2 * 60 * 60 * 1000;

  if (now - lastSent < twoHours) {
    console.log(`Rate limited: ${maskPhone(phone)} (last sent ${Math.round((now - lastSent) / 60000)}m ago)`);
    return { rateLimited: true };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('Missing AISENSY_API_KEY');

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
    media: {},
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();
  lastSentTimestamps.set(phone, now);

  await logMessage({
    phone,
    direction: 'out',
    body: `[template: ${templateName}] ${params.join(', ')}`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  return result;
}

async function sendFreeform(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('Missing AISENSY_API_KEY');

  const body = {
    apiKey,
    campaignName: 'freeform_reply',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: text,
    source: 'automation',
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();

  await logMessage({
    phone,
    direction: 'out',
    body: text,
    template_name: null,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  return result;
}

async function sendMediaTemplate(phone, templateName, mediaUrl, params = []) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('Missing AISENSY_API_KEY');

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
    media: { url: mediaUrl, filename: 'program.pdf' },
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();

  await logMessage({
    phone,
    direction: 'out',
    body: `[media: ${templateName}] ${mediaUrl}`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  return result;
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

module.exports = { sendTemplate, sendFreeform, sendMediaTemplate, maskPhone };

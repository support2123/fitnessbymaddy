import supabase from './supabase.js';

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

export async function sendTemplate(phone, templateName, params = []) {
  const canSend = await checkRateLimit(phone);
  if (!canSend) return { ok: false, reason: 'rate_limited' };

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

  const result = await res.json();

  await logMessage(phone, 'out', `[template:${templateName}] ${params.join(', ')}`, templateName);

  return { ok: res.ok, data: result };
}

export async function sendText(phone, text) {
  const canSend = await checkRateLimit(phone);
  if (!canSend) return { ok: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: { type: 'text', text },
    source: 'automation'
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();

  await logMessage(phone, 'out', text, null);

  return { ok: res.ok, data: result };
}

export async function sendDocument(phone, pdfUrl, caption) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'program_delivery',
    destination: phone,
    userName: 'FitnessByMaddy',
    media: { url: pdfUrl, filename: 'program.pdf' },
    templateParams: [caption],
    source: 'automation'
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();

  await logMessage(phone, 'out', `[document] ${caption}`, 'program_delivery');

  return { ok: res.ok, data: result };
}

async function checkRateLimit(phone) {
  const isClient = await isOptedInClient(phone);
  if (isClient) return true;

  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff);

  return (count || 0) === 0;
}

async function isOptedInClient(phone) {
  const { data } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  return data && data.length > 0;
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

export async function logIncoming(phone, body) {
  await logMessage(phone, 'in', body, null);
}

import { supabase } from './supabase.js';
import { maskPhone } from './mask.js';

const AISENSY_API_KEY = process.env.AISENSY_API_KEY;
const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function logMessage(phone, direction, body, templateName, status) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body: body?.slice(0, 2000),
    template_name: templateName || null,
    status,
  });
}

export async function sendTemplate(phone, templateName, params = []) {
  const rateLimited = await isRateLimited(phone);
  if (rateLimited) {
    console.log(`Rate-limited: skipping send to ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      templateParams: params,
      source: 'automation',
    }),
  });

  const data = await res.json().catch(() => ({}));
  await logMessage(phone, 'out', `[Template: ${templateName}] ${params.join(', ')}`, templateName, res.ok ? 'sent' : 'failed');

  if (!res.ok) {
    console.error(`WhatsApp template send failed to ${maskPhone(phone)}:`, data);
  }

  return { ok: res.ok, data };
}

export async function sendText(phone, message) {
  const rateLimited = await isRateLimited(phone);
  if (rateLimited) {
    console.log(`Rate-limited: skipping send to ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      templateParams: [message],
      source: 'automation',
    }),
  });

  const data = await res.json().catch(() => ({}));
  await logMessage(phone, 'out', message, null, res.ok ? 'sent' : 'failed');

  return { ok: res.ok, data };
}

export async function sendMediaTemplate(phone, templateName, pdfUrl, params = []) {
  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      templateParams: params,
      source: 'automation',
      media: { url: pdfUrl, filename: 'program.pdf' },
    }),
  });

  const data = await res.json().catch(() => ({}));
  await logMessage(phone, 'out', `[PDF: ${templateName}] ${pdfUrl}`, templateName, res.ok ? 'sent' : 'failed');

  return { ok: res.ok, data };
}

async function isRateLimited(phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return data && data.length >= 3;
}

export async function logIncoming(phone, body) {
  await logMessage(phone, 'in', body, null, 'received');
}

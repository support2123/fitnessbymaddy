import supabase from './supabase.js';
import { maskPhone } from './market.js';

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

export async function sendTemplate(phone, templateName, params = []) {
  const rateLimited = await isRateLimited(phone);
  if (rateLimited) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  await logMessage(phone, 'out', params.join(' | ') || templateName, templateName);

  return { ok: res.ok, data };
}

export async function sendText(phone, text) {
  const rateLimited = await isRateLimited(phone);
  if (rateLimited) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    message: text,
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  await logMessage(phone, 'out', text, null);

  return { ok: res.ok, data };
}

async function isRateLimited(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return false;
  const lastSent = new Date(data[0].sent_at).getTime();
  return Date.now() - lastSent < RATE_LIMIT_MS;
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body: body?.slice(0, 2000),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

export async function notifyMaddy(subject, details) {
  const maddy = process.env.MADDY_PHONE || '917082478374';
  await sendText(maddy, `[ESCALATION] ${subject}\n${details}`);
}

import supabase from './supabase.js';
import { maskPhone } from './utils.js';

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const AISENSY_DIRECT = 'https://backend.aisensy.com/direct/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function checkRateLimit(phone, isClient) {
  if (isClient) return true;
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return true;
  const lastSent = new Date(data[0].sent_at).getTime();
  return Date.now() - lastSent >= RATE_LIMIT_MS;
}

async function logMessage(phone, direction, body, templateName, status) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body: body || null,
    template_name: templateName || null,
    status: status || 'sent',
  });
}

export async function sendTemplate(phone, campaignName, templateParams, userName) {
  const allowed = await checkRateLimit(phone, false);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName,
    destination: phone.replace(/\D/g, ''),
    userName: userName || 'there',
    templateParams: templateParams || [],
    source: 'automation',
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    await logMessage(phone, 'out', templateParams?.join(' | '), campaignName, res.ok ? 'sent' : 'failed');
    return { ok: res.ok, data: result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    await logMessage(phone, 'out', null, campaignName, 'error');
    return { ok: false, reason: err.message };
  }
}

export async function sendSessionMessage(phone, text) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    destination: phone.replace(/\D/g, ''),
    message: text,
    type: 'text',
  };

  try {
    const res = await fetch(AISENSY_DIRECT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    await logMessage(phone, 'out', text, null, res.ok ? 'sent' : 'failed');
    return { ok: res.ok, data: result };
  } catch (err) {
    console.error(`Session message failed for ${maskPhone(phone)}:`, err.message);
    await logMessage(phone, 'out', text, null, 'error');
    return { ok: false, reason: err.message };
  }
}

export async function sendToMaddy(text) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  return sendSessionMessage(maddyPhone, text);
}

export { logMessage };

import supabase from './supabase.js';
import { maskPhone } from './market.js';

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
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

export async function sendTemplate(phone, templateName, params = [], isClient = false) {
  const allowed = await checkRateLimit(phone, isClient);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/[^0-9]/g, ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
  };

  const res = await fetch(`${AISENSY_BASE}/direct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[template: ${templateName}] ${params.join(', ')}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  if (!res.ok) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, result);
  }

  return { ok: res.ok, result };
}

export async function sendText(phone, text, isClient = false) {
  const allowed = await checkRateLimit(phone, isClient);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'direct_text',
    destination: phone.replace(/[^0-9]/g, ''),
    userName: 'FitnessByMaddy',
    message: { type: 'text', text },
  };

  const res = await fetch(`${AISENSY_BASE}/direct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok, result };
}

export async function sendDocument(phone, pdfUrl, caption, isClient = false) {
  const allowed = await checkRateLimit(phone, isClient);
  if (!allowed) return { ok: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'program_delivery',
    destination: phone.replace(/[^0-9]/g, ''),
    userName: 'FitnessByMaddy',
    message: {
      type: 'document',
      document: { link: pdfUrl, filename: 'Your_Program.pdf' },
      caption,
    },
  };

  const res = await fetch(`${AISENSY_BASE}/direct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[document] ${caption}`,
    template_name: 'program_delivery',
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok, result };
}

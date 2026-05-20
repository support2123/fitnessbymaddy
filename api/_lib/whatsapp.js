import { getSupabase } from './supabase.js';

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

export function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

export async function sendTemplate(phone, templateName, params = []) {
  const db = getSupabase();

  const rateOk = await checkRateLimit(phone);
  if (!rateOk) {
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

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json().catch(() => ({}));

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: `[template:${templateName}] ${params.join(', ')}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok, data: result };
}

export async function sendSessionMessage(phone, text) {
  const db = getSupabase();

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'session_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: text,
    source: 'automation'
  };

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok };
}

async function checkRateLimit(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();

  if (client) return true;

  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return (count || 0) < 1;
}

export async function notifyMaddy(reason, details) {
  const maddyPhone = '917082478374';
  const text = `ESCALATION: ${reason}\n${details}`;
  await sendSessionMessage(maddyPhone, text);
}

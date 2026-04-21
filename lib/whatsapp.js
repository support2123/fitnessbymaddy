import supabase from './supabase.js';

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

export async function sendTemplate(phone, templateName, params = [], mediaUrl = null) {
  const rateLimited = await checkRateLimit(phone);
  if (rateLimited) {
    console.log(`Rate limited: skipping message to ${phone.slice(0, 3)}XXX`);
    return { sent: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/[^0-9]/g, ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
  };

  if (mediaUrl) {
    body.media = { url: mediaUrl, filename: 'program.pdf' };
  }

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[template:${templateName}] ${params.join(', ')}`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  return { sent: res.ok, data };
}

export async function sendFreeform(phone, message) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_message',
    destination: phone.replace(/[^0-9]/g, ''),
    userName: 'FitnessByMaddy',
    message,
    source: 'automation',
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: message,
    template_name: null,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  return res.ok;
}

async function checkRateLimit(phone) {
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

export async function checkRateLimitForLead(phone) {
  return checkRateLimit(phone);
}

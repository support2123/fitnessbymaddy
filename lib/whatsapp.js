const { supabase } = require('./supabase');
const { maskPhone } = require('./pii');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendWhatsApp(phone, body, templateName) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: templateName || 'direct_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: [],
      message: body,
    }),
  });

  const data = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body,
    template_name: templateName || 'direct_message',
    status: res.ok ? 'sent' : 'failed',
  });

  if (!res.ok) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, data);
  }

  return { ok: res.ok, data };
}

async function sendTemplate(phone, templateName, params) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params || [],
    }),
  });

  const data = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[Template: ${templateName}]`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

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

async function logIncoming(phone, body) {
  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body,
    status: 'received',
  });
}

module.exports = { sendWhatsApp, sendTemplate, isRateLimited, logIncoming };

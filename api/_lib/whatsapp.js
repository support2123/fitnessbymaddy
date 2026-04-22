const { getClient } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendToLead(phone) {
  const sb = getClient();
  const { data } = await sb
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

async function sendTemplate(phone, templateName, params = [], bypassRateLimit = false) {
  if (!bypassRateLimit) {
    const allowed = await canSendToLead(phone);
    if (!allowed) return { ok: false, reason: 'rate_limited' };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: templateName,
      destination: phone.replace(/[^0-9]/g, ''),
      userName: 'FitnessByMaddy',
      templateParams: params,
    }),
  });

  const result = await res.json();
  const sb = getClient();
  await sb.from('messages').insert({
    phone,
    direction: 'out',
    body: `[template:${templateName}] ${params.join(', ')}`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok, result };
}

async function sendFreeform(phone, body, bypassRateLimit = false) {
  if (!bypassRateLimit) {
    const allowed = await canSendToLead(phone);
    if (!allowed) return { ok: false, reason: 'rate_limited' };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: 'freeform_message',
      destination: phone.replace(/[^0-9]/g, ''),
      userName: 'FitnessByMaddy',
      message: body,
    }),
  });

  const result = await res.json();
  const sb = getClient();
  await sb.from('messages').insert({
    phone,
    direction: 'out',
    body,
    template_name: null,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok, result };
}

module.exports = { sendTemplate, sendFreeform, canSendToLead };

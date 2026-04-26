const { supabase } = require('./supabase');
const { maskPhone, MADDY_PHONE } = require('./constants');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendToLead(phone) {
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

async function sendTemplate(phone, templateName, params = []) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('[WA] AISENSY_API_KEY not set');
    return { ok: false, error: 'api_key_missing' };
  }

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: templateName,
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      templateParams: params,
      source: 'automation',
    }),
  });

  const result = await res.json().catch(() => ({}));

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[template: ${templateName}] ${params.join(', ')}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  if (!res.ok) {
    console.error(`[WA] Failed to send to ${maskPhone(phone)}:`, result);
  }
  return { ok: res.ok, result };
}

async function sendText(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('[WA] AISENSY_API_KEY not set');
    return { ok: false, error: 'api_key_missing' };
  }

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: 'session_message',
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      message: text,
      source: 'automation',
    }),
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok };
}

async function notifyMaddy(message) {
  return sendText(MADDY_PHONE, `[ESCALATION] ${message}`);
}

module.exports = { sendTemplate, sendText, notifyMaddy, canSendToLead };

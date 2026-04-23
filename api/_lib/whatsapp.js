const { supabase } = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
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
    return { ok: false, error: 'API key missing' };
  }

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
    media: {}
  };

  try {
    const resp = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await resp.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: `[template:${templateName}] ${params.join(', ')}`,
      template_name: templateName,
      status: resp.ok ? 'sent' : 'failed'
    });

    return { ok: resp.ok, data: result };
  } catch (err) {
    console.error(`[WA] Send failed to ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendText(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('[WA] AISENSY_API_KEY not set');
    return { ok: false, error: 'API key missing' };
  }

  const payload = {
    apiKey,
    campaignName: 'text_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    message: text,
    source: 'automation'
  };

  try {
    const resp = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await resp.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: text,
      status: resp.ok ? 'sent' : 'failed'
    });

    return { ok: resp.ok, data: result };
  } catch (err) {
    console.error(`[WA] Text send failed to ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function notifyMaddy(reason, details) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  const text = `[ESCALATION] ${reason}\n${details}`;
  return sendText(maddyPhone, text);
}

module.exports = { canSendToLead, sendTemplate, sendText, notifyMaddy };

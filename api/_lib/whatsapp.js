const { getSupabase } = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSend(phone, isClient) {
  if (isClient) return true;
  const db = getSupabase();
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);
  return !data || data.length === 0;
}

async function sendTemplate(phone, templateName, params) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error(`[WA] No AISENSY_API_KEY set, skipping send to ${maskPhone(phone)}`);
    return { ok: false, error: 'no_api_key' };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'automation',
    buttons: []
  };

  try {
    const resp = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await resp.json();

    const db = getSupabase();
    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: `[template:${templateName}] ${(params || []).join(', ')}`,
      template_name: templateName,
      status: resp.ok ? 'sent' : 'failed'
    });

    return { ok: resp.ok, data: result };
  } catch (err) {
    console.error(`[WA] Send failed to ${maskPhone(phone)}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function sendText(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error(`[WA] No AISENSY_API_KEY set, skipping text to ${maskPhone(phone)}`);
    return { ok: false, error: 'no_api_key' };
  }

  try {
    const resp = await fetch('https://backend.aisensy.com/direct-apis/t1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AiSensy-Project-API-Key': apiKey
      },
      body: JSON.stringify({
        to: phone.replace(/^\+/, ''),
        type: 'text',
        recipient_type: 'individual',
        text: { body: text }
      })
    });

    const db = getSupabase();
    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: text,
      status: resp.ok ? 'sent' : 'failed'
    });

    return { ok: resp.ok };
  } catch (err) {
    console.error(`[WA] Text failed to ${maskPhone(phone)}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function notifyMaddy(subject, details) {
  const maddyPhone = '+917082478374';
  const msg = `ESCALATION: ${subject}\n${details}`;
  return sendText(maddyPhone, msg);
}

module.exports = { canSend, sendTemplate, sendText, notifyMaddy };

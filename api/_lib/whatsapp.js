const { getSupabase } = require('./supabase');
const { maskPhone } = require('./utils');

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';
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

async function sendTemplate(phone, templateName, params, userName) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error(`[WA] No AISENSY_API_KEY set, skipping send to ${maskPhone(phone)}`);
    return { ok: false, error: 'no_api_key' };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: userName || 'there',
    templateParams: params || []
  };

  try {
    const resp = await fetch(AISENSY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const result = await resp.json().catch(() => ({}));

    await logMessage(phone, 'out', params ? params.join(' | ') : templateName, templateName);

    return { ok: resp.ok, result };
  } catch (err) {
    console.error(`[WA] Send failed to ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendText(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error(`[WA] No AISENSY_API_KEY set, skipping text to ${maskPhone(phone)}`);
    return { ok: false, error: 'no_api_key' };
  }

  const body = {
    apiKey,
    campaignName: 'session_message',
    destination: phone.replace(/^\+/, ''),
    message: text,
    type: 'text'
  };

  try {
    const resp = await fetch(AISENSY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const result = await resp.json().catch(() => ({}));

    await logMessage(phone, 'out', text, null);

    return { ok: resp.ok, result };
  } catch (err) {
    console.error(`[WA] Text send failed to ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendDocument(phone, documentUrl, caption) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { ok: false, error: 'no_api_key' };

  const body = {
    apiKey,
    campaignName: 'document_message',
    destination: phone.replace(/^\+/, ''),
    media: { url: documentUrl, filename: 'program.pdf' },
    caption: caption || '',
    type: 'document'
  };

  try {
    const resp = await fetch(AISENSY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    await logMessage(phone, 'out', `[PDF] ${caption || ''}`, 'document_message');

    return { ok: resp.ok };
  } catch (err) {
    console.error(`[WA] Doc send failed to ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body ? body.substring(0, 2000) : null,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  await sendText(maddyPhone, `[ALERT] ${subject}\n${details}`);
}

module.exports = {
  canSend, sendTemplate, sendText, sendDocument,
  logMessage, notifyMaddy
};

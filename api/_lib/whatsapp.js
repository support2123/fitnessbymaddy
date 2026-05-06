const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params = []) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('[WA] AISENSY_API_KEY not set');
    return { ok: false, error: 'API key missing' };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  try {
    const resp = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();

    await logMessage(phone, 'out', `[template:${templateName}] ${params.join(', ')}`, templateName);

    return { ok: resp.ok, data };
  } catch (err) {
    console.error('[WA] Send error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function sendText(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('[WA] AISENSY_API_KEY not set');
    return { ok: false, error: 'API key missing' };
  }

  const body = {
    apiKey,
    campaignName: 'text_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    message: { type: 'text', text },
    source: 'automation'
  };

  try {
    const resp = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();

    await logMessage(phone, 'out', text, null);

    return { ok: resp.ok, data };
  } catch (err) {
    console.error('[WA] Send error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function sendMediaMessage(phone, text, mediaUrl) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { ok: false, error: 'API key missing' };

  const body = {
    apiKey,
    campaignName: 'media_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    message: { type: 'document', text },
    media: { url: mediaUrl, filename: 'program.pdf' },
    source: 'automation'
  };

  try {
    const resp = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    await logMessage(phone, 'out', `[PDF] ${text}`, null);
    return { ok: resp.ok, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function canSendToLead(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return !data || data.length === 0;
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body ? body.slice(0, 2000) : null,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

async function notifyMaddy(reason, details) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  const text = `[ESCALATION] ${reason}\n\n${details}`;
  await sendText(maddyPhone, text);
}

module.exports = {
  sendTemplate,
  sendText,
  sendMediaMessage,
  canSendToLead,
  logMessage,
  notifyMaddy
};

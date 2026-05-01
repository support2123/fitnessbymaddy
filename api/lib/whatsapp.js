const { getSupabase } = require('./supabase');
const { maskPhone } = require('./utils');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, bodyValues, mediaUrl }) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('[WhatsApp] AISENSY_API_KEY not set');
    return { ok: false, error: 'API key missing' };
  }

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    source: 'automation',
    templateParams: bodyValues || [],
  };
  if (mediaUrl) {
    payload.mediaUrl = mediaUrl;
    payload.mediaFilename = 'program.pdf';
  }

  try {
    const resp = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();

    const db = getSupabase();
    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: bodyValues ? bodyValues.join(' | ') : templateName,
      template_name: templateName,
      status: resp.ok ? 'sent' : 'failed',
    });

    if (!resp.ok) {
      console.error(`[WhatsApp] Send failed to ${maskPhone(phone)}:`, data);
      return { ok: false, error: data };
    }
    return { ok: true, data };
  } catch (err) {
    console.error(`[WhatsApp] Error sending to ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendTextMessage(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { ok: false, error: 'API key missing' };

  try {
    const resp = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        campaignName: 'session_message',
        destination: phone,
        userName: 'FitnessByMaddy',
        source: 'automation',
        message: { text },
      }),
    });
    const data = await resp.json();

    const db = getSupabase();
    await db.from('messages').insert({
      phone, direction: 'out', body: text,
      template_name: 'session_message', status: resp.ok ? 'sent' : 'failed',
    });

    return { ok: resp.ok, data };
  } catch (err) {
    console.error(`[WhatsApp] Text error to ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function notifyMaddy(subject, details) {
  const maddyPhone = '+917082478374';
  const text = `ESCALATION: ${subject}\n${details}`;
  return sendWhatsApp({
    phone: maddyPhone,
    templateName: 'escalation_alert',
    bodyValues: [subject, details],
  });
}

module.exports = { sendWhatsApp, sendTextMessage, notifyMaddy };

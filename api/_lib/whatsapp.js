const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

async function canSendMessage(phone, isClient) {
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

async function sendTemplate(phone, templateName, params = {}) {
  const allowed = await canSendMessage(phone, false);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }
  return _send(phone, templateName, params);
}

async function sendClientMessage(phone, templateName, params = {}) {
  return _send(phone, templateName, params);
}

async function sendSessionMessage(phone, body) {
  const db = getSupabase();
  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AiSensy-Project-API-Pwd': process.env.AISENSY_API_KEY
      },
      body: JSON.stringify({
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: 'session_message',
        destination: phone,
        message: body,
        userName: 'FitnessByMaddy'
      })
    });
    const result = await res.json();

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body,
      template_name: null,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok, data: result };
  } catch (err) {
    console.error(`WhatsApp send error to ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function _send(phone, templateName, params) {
  const db = getSupabase();
  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AiSensy-Project-API-Pwd': process.env.AISENSY_API_KEY
      },
      body: JSON.stringify({
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: templateName,
        destination: phone,
        templateParams: Array.isArray(params) ? params : Object.values(params),
        userName: 'FitnessByMaddy'
      })
    });
    const result = await res.json();

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: JSON.stringify(params),
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok, data: result };
  } catch (err) {
    console.error(`WhatsApp send error to ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

module.exports = {
  sendTemplate,
  sendClientMessage,
  sendSessionMessage,
  maskPhone,
  canSendMessage
};

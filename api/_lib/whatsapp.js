const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function normalizePhone(phone) {
  return phone.replace(/[^0-9+]/g, '');
}

async function canSendMessage(phone) {
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

async function sendTemplate(phone, templateName, params) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not set');
    return { ok: false, error: 'API key missing' };
  }

  const allowed = await canSendMessage(phone);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, error: 'rate_limited' };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: normalizePhone(phone),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    media: params.media || {}
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const result = await res.json();

    const db = getSupabase();
    await db.from('messages').insert({
      phone: normalizePhone(phone),
      direction: 'out',
      body: templateName + (params.templateParams ? ': ' + params.templateParams.join(', ') : ''),
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok, data: result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendTextMessage(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { ok: false, error: 'API key missing' };

  const allowed = await canSendMessage(phone);
  if (!allowed) return { ok: false, error: 'rate_limited' };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        campaignName: 'text_message',
        destination: normalizePhone(phone),
        message: text
      })
    });

    const result = await res.json();

    const db = getSupabase();
    await db.from('messages').insert({
      phone: normalizePhone(phone),
      direction: 'out',
      body: text,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok, data: result };
  } catch (err) {
    console.error(`Text send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'not eating',
  'medical', 'doctor', 'hospital'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function notifyMaddy(subject, details) {
  const maddyPhone = '+917082478374';
  await sendTemplate(maddyPhone, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [subject, details]
  });
}

module.exports = {
  maskPhone,
  detectMarket,
  normalizePhone,
  canSendMessage,
  sendTemplate,
  sendTextMessage,
  needsEscalation,
  notifyMaddy
};

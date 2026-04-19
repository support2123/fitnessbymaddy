const { supabase } = require('./supabase');

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

function isHinglish(market) {
  return market === 'IN';
}

async function sendTemplate(phone, templateName, params = {}) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { ok: false, error: 'API key missing' };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    media: params.media || {},
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: `Template: ${templateName}`,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed',
    });

    return { ok: res.ok, data };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendTextMessage(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { ok: false, error: 'API key missing' };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        campaignName: 'text_message',
        destination: phone.replace(/^\+/, ''),
        message: text,
      }),
    });

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: text,
      status: 'sent',
    });

    return { ok: res.ok };
  } catch (err) {
    console.error(`Text send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function checkRateLimit(phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);
  return data && data.length > 0;
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'not eating',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  await sendTemplate(maddyPhone, 'escalation_alert', {
    templateParams: [subject, details],
  });
}

module.exports = {
  sendTemplate,
  sendTextMessage,
  checkRateLimit,
  detectMarket,
  isHinglish,
  maskPhone,
  needsEscalation,
  notifyMaddy,
};

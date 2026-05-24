const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
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

async function sendWhatsApp(phone, templateName, params = {}, forceBypass = false) {
  if (!forceBypass) {
    const allowed = await canSendMessage(phone);
    if (!allowed) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { success: false, reason: 'rate_limited' };
    }
  }

  const db = getSupabase();
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    media: params.media || {},
    buttons: params.buttons || []
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await res.json();

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: templateName,
      template_name: templateName,
      sent_at: new Date().toISOString(),
      status: res.ok ? 'sent' : 'failed'
    });

    return { success: res.ok, result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

async function sendFreeformWhatsApp(phone, message) {
  const allowed = await canSendMessage(phone);
  if (!allowed) return { success: false, reason: 'rate_limited' };

  const db = getSupabase();
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_message',
    destination: phone.replace('+', ''),
    message
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: message,
      template_name: null,
      sent_at: new Date().toISOString(),
      status: res.ok ? 'sent' : 'failed'
    });

    return { success: res.ok };
  } catch (err) {
    console.error(`Freeform send failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulimi',
  'not eating', 'faint', 'hospital', 'doctor'
];

function needsEscalation(message) {
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(phone, message, reason) {
  const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [
      reason,
      maskPhone(phone),
      message.substring(0, 200)
    ]
  }, true);
}

module.exports = {
  sendWhatsApp,
  sendFreeformWhatsApp,
  canSendMessage,
  detectMarket,
  maskPhone,
  needsEscalation,
  escalateToMaddy
};

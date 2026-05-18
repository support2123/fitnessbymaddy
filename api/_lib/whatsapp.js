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

async function sendWhatsApp(phone, templateName, params = {}) {
  const db = getSupabase();

  const { data: recent } = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (recent && recent.length > 0) {
    const lastSent = new Date(recent[0].sent_at);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const { data: client } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    if (lastSent > twoHoursAgo && (!client || client.length === 0)) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { rateLimited: true };
    }
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    media: params.media || {}
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: `Template: ${templateName}`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed'
  });

  return result;
}

async function logIncomingMessage(phone, body) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body,
    sent_at: new Date().toISOString(),
    status: 'received'
  });
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pain', 'dizziness', 'pregnant', 'pregnancy',
  'medication', 'disordered', 'eating disorder', 'medical'
];

function checkEscalation(text) {
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
}

async function notifyMaddy(subject, details) {
  const maddy = process.env.MADDY_PHONE || '+917082478374';
  await sendWhatsApp(maddy, 'admin_alert', {
    name: 'Maddy',
    templateParams: [subject, details]
  });
}

module.exports = {
  sendWhatsApp,
  logIncomingMessage,
  maskPhone,
  detectMarket,
  checkEscalation,
  notifyMaddy
};

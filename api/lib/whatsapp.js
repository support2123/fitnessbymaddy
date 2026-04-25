const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('91') || cleaned.startsWith('+91')) return 'IN';
  if (cleaned.startsWith('971') || cleaned.startsWith('+971')) return 'UAE';
  if (cleaned.startsWith('44') || cleaned.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}

function normalizePhone(phone) {
  if (!phone) return '';
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) cleaned = '91' + cleaned;
  return cleaned;
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

async function sendWhatsApp(phone, templateName, params, skipRateLimit) {
  const db = getSupabase();

  if (!skipRateLimit) {
    const allowed = await canSendMessage(phone);
    if (!allowed) {
      return { success: false, reason: 'rate_limited' };
    }
  }

  const { data: optOut } = await db
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .eq('status', 'dropped')
    .limit(1);

  if (optOut && optOut.length > 0) {
    return { success: false, reason: 'opted_out' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params || [],
  };

  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await resp.json();
  const success = resp.ok;

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: JSON.stringify({ template: templateName, params }),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: success ? 'sent' : 'failed',
  });

  return { success, result };
}

async function sendEscalation(reason, details) {
  const MADDY_PHONE = '917082478374';
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [reason, details], true);
}

module.exports = {
  sendWhatsApp,
  sendEscalation,
  detectMarket,
  normalizePhone,
  maskPhone,
  canSendMessage,
};

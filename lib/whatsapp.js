const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, params = [], body = '' }) {
  const db = getSupabase();

  const rateLimitOk = await checkRateLimit(db, phone);
  if (!rateLimitOk) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const payload = templateName
    ? {
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: templateName,
        destination: phone,
        userName: 'FitnessByMaddy',
        templateParams: params,
      }
    : {
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: 'direct_message',
        destination: phone,
        userName: 'FitnessByMaddy',
        message: body,
      };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || `template:${templateName}`,
    template_name: templateName || null,
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok, result };
}

async function checkRateLimit(db, phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return (count || 0) < 1;
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

async function sendEscalation(message) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  await sendWhatsApp({
    phone: maddyPhone,
    body: `🚨 ESCALATION: ${message}`,
  });
}

module.exports = { sendWhatsApp, maskPhone, sendEscalation };

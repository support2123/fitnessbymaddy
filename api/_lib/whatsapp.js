const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, params = [], body = null }) {
  const db = getSupabase();

  const rateLimitOk = await checkRateLimit(db, phone);
  if (!rateLimitOk) {
    console.log(`Rate limited: ${phone.slice(0, 3)}XXX...${phone.slice(-3)}`);
    return { sent: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
  };

  if (body) {
    payload.message = body;
  }

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  const status = res.ok ? 'sent' : 'failed';

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || templateName,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status,
  });

  return { sent: res.ok, result };
}

async function checkRateLimit(db, phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  const { data: clientData } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  if (clientData && clientData.length > 0) return true;

  return !data || data.length === 0;
}

module.exports = { sendWhatsApp };

const { getSupabase } = require('./supabase');

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendWhatsApp({ phone, message, templateName, templateParams }) {
  const db = getSupabase();

  const isTemplate = !!templateName;

  if (!isTemplate) {
    const rateOk = await checkRateLimit(phone);
    if (!rateOk) return { sent: false, reason: 'rate_limited' };
  }

  const payload = isTemplate
    ? {
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: templateName,
        destination: phone,
        userName: templateParams?.name || 'there',
        templateParams: templateParams?.params || [],
        source: 'automation',
        media: templateParams?.media || {},
        buttons: templateParams?.buttons || [],
      }
    : {
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: 'session_reply',
        destination: phone,
        userName: 'there',
        templateParams: [message],
        source: 'automation',
      };

  const resp = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await resp.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: message || `[template: ${templateName}]`,
    template_name: templateName || null,
    status: resp.ok ? 'sent' : 'failed',
  });

  return { sent: resp.ok, result };
}

async function checkRateLimit(phone) {
  const db = getSupabase();
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);

  const isClient = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  if (isClient.data?.length > 0) return true;
  return !data || data.length === 0;
}

async function notifyMaddy(reason, details) {
  const maddy = process.env.MADDY_PHONE || '+917082478374';
  await sendWhatsApp({
    phone: maddy,
    message: `[ESCALATION] ${reason}\n${details}`,
  });
}

module.exports = { sendWhatsApp, notifyMaddy };

const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendWhatsApp({ phone, templateName, body, params }) {
  const db = getSupabase();

  const isClient = await checkIsClient(phone);
  if (!isClient) {
    const rateLimited = await isRateLimited(phone);
    if (rateLimited) {
      console.log(`Rate-limited: skipping msg to ${maskPhone(phone)}`);
      return { sent: false, reason: 'rate_limited' };
    }
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName || 'direct_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    message: body || ''
  };

  if (templateName) {
    payload.source = 'automation';
    payload.template = { name: templateName };
  }

  const resp = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await resp.json();
  const success = resp.ok;

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || `[template:${templateName}]`,
    template_name: templateName || null,
    status: success ? 'sent' : 'failed'
  });

  if (!success) {
    console.error(`WA send failed to ${maskPhone(phone)}:`, result);
  }

  return { sent: success, result };
}

async function isRateLimited(phone) {
  const db = getSupabase();
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);
  return data && data.length > 0;
}

async function checkIsClient(phone) {
  const db = getSupabase();
  const { data } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);
  return data && data.length > 0;
}

module.exports = { sendWhatsApp, isRateLimited };

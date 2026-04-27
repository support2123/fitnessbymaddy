const { getSupabase } = require('./supabase');

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, params = [], body = null }) {
  const db = getSupabase();
  const key = process.env.AISENSY_API_KEY;

  const lastMsg = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();

  if (lastMsg.data) {
    const gap = Date.now() - new Date(lastMsg.data.sent_at).getTime();
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const isClient = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (gap < TWO_HOURS && !isClient.data) {
      return { rateLimited: true };
    }
  }

  const payload = {
    apiKey: key,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
  };

  if (body) {
    payload.message = body;
  }

  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || `[template: ${templateName}] ${params.join(', ')}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok, result };
}

async function notifyMaddy(message) {
  const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';
  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    params: [message],
  });
}

module.exports = { sendWhatsApp, notifyMaddy };

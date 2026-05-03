const { getSupabase } = require('./supabase');
const { maskPhone } = require('./mask');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, body, params }) {
  const db = getSupabase();

  const recentMsg = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();

  if (recentMsg.data) {
    const diff = Date.now() - new Date(recentMsg.data.sent_at).getTime();
    const TWO_HOURS = 2 * 60 * 60 * 1000;

    const isClient = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (diff < TWO_HOURS && !isClient.data) {
      console.log(`Rate limited: ${maskPhone(phone)} — last msg ${Math.round(diff / 60000)}m ago`);
      return { rateLimited: true };
    }
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName || 'direct_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  if (body && !templateName) {
    payload.message = body;
  }

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || `[template: ${templateName}]`,
    template_name: templateName || null,
    status: res.ok ? 'sent' : 'failed'
  });

  if (!res.ok) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, result);
  }

  return { ok: res.ok, result };
}

async function logIncoming({ phone, body }) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body
  });
}

module.exports = { sendWhatsApp, logIncoming };

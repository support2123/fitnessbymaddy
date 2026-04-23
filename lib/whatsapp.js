const { getClient } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, body, params }) {
  const db = getClient();

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  const { data: lead } = await db
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .single();

  if (lead && lead.status === 'dropped') return { skipped: true, reason: 'opted_out' };

  const isClient = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  const isOptedInClient = isClient.data && isClient.data.length > 0;

  if (!isOptedInClient && recent && recent.length > 0) {
    return { skipped: true, reason: 'rate_limited' };
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
    body: body || `template:${templateName}`,
    template_name: templateName || null,
    status: res.ok ? 'sent' : 'failed'
  });

  return { sent: res.ok, result };
}

async function logIncoming({ phone, body }) {
  const db = getClient();
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body,
    status: 'received'
  });
}

module.exports = { sendWhatsApp, logIncoming };

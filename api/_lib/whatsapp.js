const { getSupabase } = require('./supabase');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendWhatsApp({ phone, templateName, body, params }) {
  const db = getSupabase();

  const { data: recent } = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (recent && recent.length > 0) {
    const lastSent = new Date(recent[0].sent_at).getTime();
    const now = Date.now();
    const { data: client } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    const isActiveClient = client && client.length > 0;
    if (!isActiveClient && now - lastSent < RATE_LIMIT_MS) {
      return { sent: false, reason: 'rate_limited' };
    }
  }

  const { data: lead } = await db
    .from('leads')
    .select('opted_out')
    .eq('phone', phone)
    .limit(1);

  if (lead && lead.length > 0 && lead[0].opted_out) {
    return { sent: false, reason: 'opted_out' };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  const payload = {
    apiKey,
    campaignName: templateName || 'direct_message',
    destination: phone.replace(/^\+/, ''),
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

  const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || `template:${templateName}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return { sent: res.ok, result };
}

module.exports = { sendWhatsApp };

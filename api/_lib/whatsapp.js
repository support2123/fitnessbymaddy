const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, params) {
  const db = getSupabase();

  const recent = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();

  if (recent.data) {
    const lastSent = new Date(recent.data.sent_at);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const isClient = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (lastSent > twoHoursAgo && !isClient.data) {
      return { skipped: true, reason: 'rate_limited' };
    }
  }

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params || [],
    }),
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: params ? params.join(' | ') : templateName,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return { sent: res.ok, result };
}

async function sendFreeformWhatsApp(phone, message) {
  const db = getSupabase();

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'freeform_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message,
    }),
  });

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: message,
    template_name: 'freeform',
    status: res.ok ? 'sent' : 'failed',
  });

  return { sent: res.ok };
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp, maskPhone };

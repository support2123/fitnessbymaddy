const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, body, templateName) {
  const db = getSupabase();

  const lastMsg = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();

  if (lastMsg.data) {
    const elapsed = Date.now() - new Date(lastMsg.data.sent_at).getTime();
    const isClient = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (!isClient.data && elapsed < 2 * 60 * 60 * 1000) {
      return { skipped: true, reason: 'rate_limited' };
    }
  }

  const dropped = await db
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .eq('status', 'dropped')
    .single();

  if (dropped.data) {
    return { skipped: true, reason: 'opted_out' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName || 'direct_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: [],
    message: body
  };

  const resp = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await resp.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body,
    template_name: templateName || null,
    status: resp.ok ? 'sent' : 'failed'
  });

  return { sent: resp.ok, result };
}

async function logInboundMessage(phone, body) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body,
    status: 'received'
  });
}

module.exports = { sendWhatsApp, logInboundMessage };

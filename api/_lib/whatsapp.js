const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  return (phone || '').replace(/(\+\d{2})\d+(\d{3})/, '$1XXX...$2');
}

async function sendWhatsApp({ phone, templateName, body, params }) {
  const db = getSupabase();

  const { data: recentMsg } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .limit(1);

  const { data: activeClient } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  const isClient = activeClient && activeClient.length > 0;

  if (!isClient && recentMsg && recentMsg.length > 0) {
    return { rateLimited: true };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
  };

  let ok = false;
  let result = {};
  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    ok = res.ok;
    result = await res.json();
  } catch (err) {
    result = { error: err.message };
  }

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || `[template:${templateName}]`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: ok ? 'sent' : 'failed',
  });

  return { ok, result };
}

async function logIncoming({ phone, body }) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body,
    sent_at: new Date().toISOString(),
    status: 'received',
  });
}

module.exports = { sendWhatsApp, logIncoming, maskPhone };

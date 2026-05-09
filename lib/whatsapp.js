const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, message, templateName }) {
  const db = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;

  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { ok: false, error: 'API key missing' };
  }

  const rateOk = await checkRateLimit(db, phone);
  if (!rateOk) {
    return { ok: false, error: 'Rate limited — max 1 msg per 2hrs for non-clients' };
  }

  const payload = {
    apiKey,
    campaignName: templateName || 'direct_message',
    destination: phone.replace(/[^0-9]/g, ''),
    userName: 'FitnessByMaddy',
    templateParams: [],
    message: message || ''
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: message,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok, data };
  } catch (err) {
    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: message,
      template_name: templateName,
      status: 'error'
    });
    return { ok: false, error: err.message };
  }
}

async function checkRateLimit(db, phone) {
  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();

  if (client) return true;

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return (count || 0) < 1;
}

async function logInbound(phone, body) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body,
    status: 'received'
  });
}

module.exports = { sendWhatsApp, logInbound };

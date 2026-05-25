const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, params = []) {
  const db = getSupabase();

  const last = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();

  if (last.data) {
    const elapsed = Date.now() - new Date(last.data.sent_at).getTime();
    const twoHours = 2 * 60 * 60 * 1000;
    const isClient = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (elapsed < twoHours && !isClient.data) {
      return { ok: false, reason: 'rate_limited' };
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
      templateParams: params,
    }),
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: `Template: ${templateName} | Params: ${JSON.stringify(params)}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok, result };
}

async function sendFreeformWhatsApp(phone, message) {
  const db = getSupabase();

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
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
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok };
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp, maskPhone, detectMarket };

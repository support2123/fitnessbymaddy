const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, params = [], mediaUrl }) {
  const db = getSupabase();

  const rateCheck = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .order('sent_at', { ascending: false })
    .limit(1);

  const isClient = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  if (rateCheck.data?.length > 0 && !isClient.data?.length) {
    return { sent: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
  };

  if (mediaUrl) {
    body.mediaUrl = mediaUrl;
    body.mediaFilename = 'program.pdf';
  }

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: `Template: ${templateName} | Params: ${JSON.stringify(params)}`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  return { sent: res.ok, result };
}

async function sendFreeformWhatsApp({ phone, message }) {
  const db = getSupabase();

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_session',
    destination: phone,
    userName: 'FitnessByMaddy',
    message,
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: message,
    template_name: null,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  return { sent: res.ok };
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp };

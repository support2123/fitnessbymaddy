const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, params = [], mediaUrl) {
  const db = getSupabase();

  const rateCheck = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .order('sent_at', { ascending: false })
    .limit(1);

  if (rateCheck.data && rateCheck.data.length > 0) {
    const isClient = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    if (!isClient.data || isClient.data.length === 0) {
      return { rateLimited: true };
    }
  }

  const optOut = await db
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .eq('status', 'dropped')
    .limit(1);

  if (optOut.data && optOut.data.length > 0) {
    return { optedOut: true };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params
  };

  if (mediaUrl) {
    body.mediaUrl = mediaUrl;
    body.mediaFilename = 'program.pdf';
  }

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: `Template: ${templateName} | Params: ${JSON.stringify(params)}`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed'
  });

  return { sent: res.ok, result };
}

async function sendFreeformWhatsApp(phone, message) {
  const db = getSupabase();

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: message,
    template_name: null,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed'
  });

  return res.ok;
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp, maskPhone };

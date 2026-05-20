const { getSupabase } = require('./supabase');
const { maskPhone } = require('./utils');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, bodyValues = [], mediaUrl = null) {
  const db = getSupabase();

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

  const isClient = !lead || lead.status === 'converted';

  if (!isClient && recent && recent.length > 0) {
    console.log(`Rate limited: skipping message to ${maskPhone(phone)}`);
    return { skipped: true, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: bodyValues,
  };

  if (mediaUrl) {
    payload.mediaUrl = mediaUrl;
    payload.mediaFilename = 'program.pdf';
  }

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: `Template: ${templateName} | Params: ${bodyValues.join(', ')}`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  if (!res.ok) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, result);
  }

  return result;
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
    template_name: null,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  return res.json();
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp };

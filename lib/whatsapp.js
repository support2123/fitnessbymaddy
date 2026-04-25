const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, bodyValues, mediaUrl) {
  const allowed = await checkOptOut(phone);
  if (!allowed) return { skipped: true, reason: 'opted_out' };

  const rateOk = await checkRateLimit(phone);
  if (!rateOk) return { skipped: true, reason: 'rate_limited' };

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: bodyValues || [],
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
  const data = await res.json();

  await logMessage(phone, 'out', templateName, bodyValues, data.status || 'sent');

  return data;
}

async function checkOptOut(phone) {
  const db = getSupabase();
  const { data } = await db
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .single();
  if (data && data.status === 'dropped') {
    const { data: client } = await db
      .from('clients')
      .select('status')
      .eq('phone', phone)
      .in('status', ['active', 'paused'])
      .single();
    if (!client) return false;
  }
  return true;
}

async function checkRateLimit(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .in('status', ['active', 'paused'])
    .single();
  if (client) return true;

  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return (count || 0) < 1;
}

async function logMessage(phone, direction, templateOrBody, params, status) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: direction === 'out' ? `[template:${templateOrBody}] ${JSON.stringify(params || [])}` : templateOrBody,
    template_name: direction === 'out' ? templateOrBody : null,
    sent_at: new Date().toISOString(),
    status: status || 'sent',
  });
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

module.exports = { sendWhatsApp, logMessage, maskPhone, checkOptOut };

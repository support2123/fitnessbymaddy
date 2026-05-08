const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

async function sendWhatsApp(phone, templateName, params = {}, bodyText = null) {
  const db = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;

  const now = new Date();
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();

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

  if (lead && lead.status === 'dropped') {
    console.log(`Blocked: ${maskPhone(phone)} is dropped/opted-out`);
    return { blocked: true, reason: 'opted_out' };
  }

  const isClient = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  if (recent && recent.length > 0 && !isClient.data) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { blocked: true, reason: 'rate_limited' };
  }

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone,
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    source: 'fitnessbymaddy-automation',
    buttons: params.buttons || []
  };

  if (bodyText) {
    payload.message = bodyText;
  }

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: bodyText || `[template: ${templateName}]`,
    template_name: templateName,
    sent_at: now.toISOString(),
    status: res.ok ? 'sent' : 'failed'
  });

  return { sent: res.ok, result };
}

async function logIncoming(phone, body) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body,
    sent_at: new Date().toISOString(),
    status: 'received'
  });
}

module.exports = { sendWhatsApp, logIncoming, maskPhone };

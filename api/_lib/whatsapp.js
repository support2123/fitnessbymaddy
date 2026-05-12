const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

async function canSendMessage(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();

  if (client) return true;

  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return (count || 0) === 0;
}

async function isOptedOut(phone) {
  const db = getSupabase();
  const { data } = await db
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .eq('status', 'dropped')
    .maybeSingle();
  return !!data;
}

async function sendWhatsApp(phone, templateName, params = {}) {
  const db = getSupabase();

  if (await isOptedOut(phone)) {
    console.log(`Skipping opted-out number ${maskPhone(phone)}`);
    return { skipped: true, reason: 'opted_out' };
  }

  if (!(await canSendMessage(phone))) {
    console.log(`Rate limited for ${maskPhone(phone)}`);
    return { skipped: true, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    source: 'fitnessbymaddy-automation',
    buttons: params.buttons || [],
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: templateName,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  return result;
}

async function sendFreeformWhatsApp(phone, message) {
  const db = getSupabase();

  if (await isOptedOut(phone)) return { skipped: true, reason: 'opted_out' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_message',
    destination: phone.replace(/^\+/, ''),
    message,
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: message,
    template_name: null,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  return result;
}

module.exports = {
  sendWhatsApp,
  sendFreeformWhatsApp,
  detectMarket,
  maskPhone,
  canSendMessage,
  isOptedOut,
};

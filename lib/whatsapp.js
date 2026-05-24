const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const clean = phone.replace(/\D/g, '');
  if (clean.startsWith('91')) return 'IN';
  if (clean.startsWith('971')) return 'UAE';
  if (clean.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

async function sendTemplate(phone, templateName, params = []) {
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

  if (lead && lead.status === 'dropped') {
    console.log(`Blocked: ${maskPhone(phone)} is dropped/opted-out`);
    return { blocked: true, reason: 'opted_out' };
  }

  const isClient = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  const isOptedInClient = isClient.data && isClient.data.length > 0;

  if (!isOptedInClient && recent && recent.length > 0) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { blocked: true, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/\D/g, ''),
    userName: 'FitnessByMaddy',
    templateParams: params
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: params.join(' | ') || templateName,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return result;
}

async function sendFreeform(phone, text) {
  const db = getSupabase();

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_message',
    destination: phone.replace(/\D/g, ''),
    userName: 'FitnessByMaddy',
    message: text
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: res.ok ? 'sent' : 'failed'
  });

  return res.ok;
}

module.exports = { sendTemplate, sendFreeform, maskPhone, detectMarket };

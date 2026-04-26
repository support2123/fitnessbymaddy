const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

async function canSendToLead(phone) {
  const sb = getSupabase();
  const { data } = await sb
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return true;
  const lastSent = new Date(data[0].sent_at).getTime();
  return Date.now() - lastSent >= RATE_LIMIT_MS;
}

async function sendTemplate(phone, templateName, params = []) {
  const sb = getSupabase();

  const { data: lead } = await sb
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .single();

  if (lead && lead.status === 'dropped') return { skipped: true, reason: 'opted-out' };

  const { data: client } = await sb
    .from('clients')
    .select('status')
    .eq('phone', phone)
    .single();

  const isClient = client && client.status === 'active';

  if (!isClient) {
    const allowed = await canSendToLead(phone);
    if (!allowed) return { skipped: true, reason: 'rate-limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation'
  };

  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await resp.json();

  await sb.from('messages').insert({
    phone,
    direction: 'out',
    body: params.join(' | ') || templateName,
    template_name: templateName,
    status: resp.ok ? 'sent' : 'failed'
  });

  return result;
}

async function sendFreeform(phone, text) {
  const sb = getSupabase();

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_text',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: { type: 'text', text },
    source: 'automation'
  };

  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  await sb.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    template_name: null,
    status: resp.ok ? 'sent' : 'failed'
  });

  return resp.json();
}

module.exports = { sendTemplate, sendFreeform, maskPhone, canSendToLead };

const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_API_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, params, body }) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: recentMessages } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  const { data: lead } = await supabase
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .single();

  const isClient = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  const isOptedIn = isClient.data !== null;

  if (recentMessages && recentMessages.length > 0 && !isOptedIn) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { sent: false, reason: 'rate_limited' };
  }

  if (lead && lead.status === 'dropped') {
    console.log(`Blocked (dropped/opted-out): ${maskPhone(phone)}`);
    return { sent: false, reason: 'opted_out' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'automation'
  };

  if (body) {
    payload.message = body;
  }

  const response = await fetch(AISENSY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: body || `[template: ${templateName}]`,
    template_name: templateName,
    status: response.ok ? 'sent' : 'failed'
  });

  return { sent: response.ok, result };
}

async function logIncomingMessage(phone, body) {
  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body,
    status: 'received'
  });
}

module.exports = { sendWhatsApp, logIncomingMessage };

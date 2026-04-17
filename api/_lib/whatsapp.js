const { getSupabase } = require('./supabase');
const { maskPhone } = require('./mask');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, params = []) {
  const allowed = await checkRateLimit(phone);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { sent: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();
  const supabase = getSupabase();
  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: params.join(' | '),
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return { sent: res.ok, result };
}

async function sendFreeformWhatsApp(phone, message) {
  const allowed = await checkRateLimit(phone);
  if (!allowed) return { sent: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message,
    source: 'automation'
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const supabase = getSupabase();
  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: message,
    template_name: 'freeform_message',
    status: res.ok ? 'sent' : 'failed'
  });

  return { sent: res.ok };
}

async function checkRateLimit(phone) {
  const supabase = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  const { data: clientData } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  const isClient = clientData && clientData.length > 0;
  if (isClient) return true;

  return !data || data.length === 0;
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp, checkRateLimit };

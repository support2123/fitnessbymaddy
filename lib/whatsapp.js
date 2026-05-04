const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, params = []) {
  const allowed = await checkRateLimit(phone);
  if (!allowed) return { ok: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  const supabase = getSupabase();

  await supabase.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'out',
    body: `Template: ${templateName}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok, data };
}

async function sendFreeformWhatsApp(phone, message) {
  const allowed = await checkRateLimit(phone);
  if (!allowed) return { ok: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: message,
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const supabase = getSupabase();
  await supabase.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'out',
    body: message.substring(0, 500),
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok };
}

async function sendWhatsAppMedia(phone, templateName, mediaUrl, params = []) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
    mediaUrl: mediaUrl,
    mediaFilename: 'program.pdf',
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const supabase = getSupabase();
  await supabase.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'out',
    body: `Media: ${templateName}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok };
}

async function checkRateLimit(phone) {
  const supabase = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', maskPhone(phone))
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  const { data: clientData } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  if (clientData && clientData.length > 0) return true;
  return !data || data.length < 1;
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return phone;
  return phone.substring(0, 4) + 'XXX...' + phone.slice(-3);
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp, sendWhatsAppMedia, maskPhone };

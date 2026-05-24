const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const AISENSY_KEY = process.env.AISENSY_API_KEY;

async function canSend(phone, isClient) {
  if (isClient) return true;

  const { data } = await supabase
    .from('rate_limits')
    .select('last_sent_at')
    .eq('phone', phone)
    .single();

  if (!data) return true;

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  return new Date(data.last_sent_at) < twoHoursAgo;
}

async function updateRateLimit(phone, isClient) {
  await supabase
    .from('rate_limits')
    .upsert({ phone, last_sent_at: new Date().toISOString(), is_client: isClient }, { onConflict: 'phone' });
}

async function sendTemplate(phone, templateName, params = []) {
  const allowed = await canSend(phone, false);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: AISENSY_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
    media: {}
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: params.join(' | '),
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  await updateRateLimit(phone, false);

  return { ok: res.ok, result };
}

async function sendText(phone, text) {
  const body = {
    apiKey: AISENSY_KEY,
    campaignName: 'direct_text',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message: text,
    source: 'automation'
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    template_name: null,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok };
}

async function sendMedia(phone, mediaUrl, caption) {
  const body = {
    apiKey: AISENSY_KEY,
    campaignName: 'media_send',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    media: { url: mediaUrl, filename: 'program.pdf' },
    templateParams: [caption || 'Your weekly program'],
    source: 'automation'
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: caption || 'Program PDF sent',
    template_name: 'media_send',
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok };
}

module.exports = { sendTemplate, sendText, sendMedia, canSend };

const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params = [], mediaUrl = null) {
  const rateOk = await checkRateLimit(phone);
  if (!rateOk) return { ok: false, error: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'fitnessbymaddy-automation'
  };

  if (mediaUrl) {
    body.media = { url: mediaUrl, filename: 'program.pdf' };
  }

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  const ok = res.ok;

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: params.join(' | ') || templateName,
    template_name: templateName,
    status: ok ? 'sent' : 'failed'
  });

  return { ok, data };
}

async function sendText(phone, message) {
  const rateOk = await checkRateLimit(phone);
  if (!rateOk) return { ok: false, error: 'rate_limited' };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'session_reply',
      destination: phone.replace(/^\+/, ''),
      userName: 'FitnessByMaddy',
      templateParams: [message],
      source: 'fitnessbymaddy-automation'
    })
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: message,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok };
}

async function checkRateLimit(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return true;

  const lastSent = new Date(data[0].sent_at);
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  if (client && client.length > 0) return true;

  return lastSent < twoHoursAgo;
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'escalation_alert',
      destination: maddyPhone,
      userName: 'System',
      templateParams: [subject, details],
      source: 'fitnessbymaddy-escalation'
    })
  });
}

module.exports = { sendTemplate, sendText, checkRateLimit, notifyMaddy };

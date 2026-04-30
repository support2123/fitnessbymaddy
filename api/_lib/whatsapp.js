const { supabase } = require('./supabase');
const { maskPhone } = require('./market');
const { RATE_LIMIT_MS } = require('./constants');

async function sendWhatsApp(phone, body, templateName) {
  const canSend = await checkRateLimit(phone);
  if (!canSend) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { ok: false, reason: 'no_api_key' };
  }

  const payload = templateName
    ? { apiKey, campaignName: templateName, destination: phone, userName: 'FitnessByMaddy', message: body }
    : { apiKey, campaignName: 'direct_message', destination: phone, userName: 'FitnessByMaddy', message: body };

  try {
    const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: body || templateName,
      template_name: templateName || null,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok, data: result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
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

  const lastSent = new Date(data[0].sent_at).getTime();
  return Date.now() - lastSent >= RATE_LIMIT_MS;
}

async function sendWhatsAppToClient(phone, body, templateName) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { ok: false, reason: 'no_api_key' };

  const payload = templateName
    ? { apiKey, campaignName: templateName, destination: phone, userName: 'FitnessByMaddy', message: body }
    : { apiKey, campaignName: 'direct_message', destination: phone, userName: 'FitnessByMaddy', message: body };

  try {
    const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: body || templateName,
      template_name: templateName || null,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok };
  } catch (err) {
    console.error(`Client WA send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

module.exports = { sendWhatsApp, sendWhatsAppToClient, checkRateLimit };

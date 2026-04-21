const { supabase } = require('./supabase');
const { maskPhone } = require('./utils');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendMessage(phone, isClient) {
  if (isClient) return true;

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

async function sendTemplate(phone, templateName, params = []) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error(`[WA] No API key configured, skipping send to ${maskPhone(phone)}`);
    return { ok: false, error: 'no_api_key' };
  }

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await res.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: params.join(' | '),
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed',
    });

    return { ok: res.ok, result };
  } catch (err) {
    console.error(`[WA] Send failed for ${maskPhone(phone)}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function sendFreeformMessage(phone, message) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { ok: false, error: 'no_api_key' };

  const payload = {
    apiKey,
    campaignName: 'freeform_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    message,
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: message,
      template_name: 'freeform_message',
      status: res.ok ? 'sent' : 'failed',
    });

    return { ok: res.ok };
  } catch (err) {
    console.error(`[WA] Freeform failed for ${maskPhone(phone)}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function sendMediaMessage(phone, mediaUrl, caption) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { ok: false, error: 'no_api_key' };

  const payload = {
    apiKey,
    campaignName: 'media_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    media: { url: mediaUrl, filename: 'program.pdf' },
    message: caption || '',
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: caption || '[PDF]',
      template_name: 'media_message',
      status: res.ok ? 'sent' : 'failed',
    });

    return { ok: res.ok };
  } catch (err) {
    console.error(`[WA] Media failed for ${maskPhone(phone)}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { canSendMessage, sendTemplate, sendFreeformMessage, sendMediaMessage };

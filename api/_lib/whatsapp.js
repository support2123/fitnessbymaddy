const { supabase } = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function checkRateLimit(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    const lastSent = new Date(data[0].sent_at).getTime();
    if (Date.now() - lastSent < RATE_LIMIT_MS) return false;
  }
  return true;
}

async function sendTemplate(phone, templateName, params, skipRateLimit) {
  if (!skipRateLimit) {
    const allowed = await checkRateLimit(phone);
    if (!allowed) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { ok: false, reason: 'rate_limited' };
    }
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not set');
    return { ok: false, reason: 'no_api_key' };
  }

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params || []
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: params ? params.join(' | ') : templateName,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok, result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function sendText(phone, text, skipRateLimit) {
  if (!skipRateLimit) {
    const allowed = await checkRateLimit(phone);
    if (!allowed) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { ok: false, reason: 'rate_limited' };
    }
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not set');
    return { ok: false, reason: 'no_api_key' };
  }

  const payload = {
    apiKey,
    campaignName: 'session_text',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message: { type: 'text', text }
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: text,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok };
  } catch (err) {
    console.error(`WhatsApp text failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

module.exports = { sendTemplate, sendText, checkRateLimit };

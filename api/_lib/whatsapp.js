const { supabase } = require('./supabase');

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000;

function maskPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 6) return '***';
  return digits.slice(0, 3) + '*'.repeat(digits.length - 6) + digits.slice(-3);
}

async function isRateLimited(phone) {
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();

  if (client) return false;

  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();

  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff);

  return (count || 0) >= 1;
}

async function logMessage(phone, direction, body, templateName, status) {
  const { error } = await supabase.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName || null,
    sent_at: new Date().toISOString(),
    status,
  });

  if (error) {
    console.error(`Failed to log message for ${maskPhone(phone)}:`, error.message);
  }
}

async function sendTemplate(phone, templateName, params = {}) {
  if (await isRateLimited(phone)) {
    console.warn(`Rate limited: skipping template to ${maskPhone(phone)}`);
    return { success: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: params.userName || phone,
    templateParams: params.templateParams || [],
    source: 'fitnessbymaddy',
  };

  if (params.mediaUrl) {
    payload.mediaUrl = params.mediaUrl;
  }

  try {
    const res = await fetch(AISENSY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const status = res.ok ? 'sent' : 'failed';
    const bodyText = (params.templateParams || []).join(', ');

    await logMessage(phone, 'out', bodyText, templateName, status);

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`Template send failed for ${maskPhone(phone)}: ${res.status} ${errBody}`);
      return { success: false, reason: 'api_error', status: res.status };
    }

    return { success: true };
  } catch (err) {
    await logMessage(phone, 'out', '', templateName, 'error');
    console.error(`Template send error for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: 'network_error' };
  }
}

async function sendText(phone, message) {
  if (await isRateLimited(phone)) {
    console.warn(`Rate limited: skipping text to ${maskPhone(phone)}`);
    return { success: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'session_text',
    destination: phone,
    userName: phone,
    templateParams: [message],
    source: 'fitnessbymaddy',
  };

  try {
    const res = await fetch(AISENSY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const status = res.ok ? 'sent' : 'failed';
    await logMessage(phone, 'out', message, null, status);

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`Text send failed for ${maskPhone(phone)}: ${res.status} ${errBody}`);
      return { success: false, reason: 'api_error', status: res.status };
    }

    return { success: true };
  } catch (err) {
    await logMessage(phone, 'out', message, null, 'error');
    console.error(`Text send error for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: 'network_error' };
  }
}

module.exports = { sendTemplate, sendText, maskPhone };

const { supabase } = require('./supabase');
const { maskPhone } = require('./pii');

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

// ---------------------------------------------------------------------------
// Market detection from phone prefix
// ---------------------------------------------------------------------------
function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/\s+/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

// ---------------------------------------------------------------------------
// Rate-limit check: max 1 outbound message per lead per 2 hours
// ---------------------------------------------------------------------------
async function isRateLimited(phone) {
  const since = new Date(Date.now() - RATE_LIMIT_MS).toISOString();

  const { data, error } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', since)
    .limit(1);

  if (error) {
    console.error(`Rate-limit check failed for ${maskPhone(phone)}:`, error.message);
    return false; // fail-open so we don't silently drop messages
  }

  return data && data.length > 0;
}

// ---------------------------------------------------------------------------
// Log message to the messages table
// ---------------------------------------------------------------------------
async function logMessage(phone, direction, body, templateName) {
  const { error } = await supabase.from('messages').insert({
    phone,
    direction,
    body: body || null,
    template_name: templateName || null,
  });

  if (error) {
    console.error(`Failed to log message for ${maskPhone(phone)}:`, error.message);
  }
}

// ---------------------------------------------------------------------------
// Send template message via AiSensy
// ---------------------------------------------------------------------------
async function sendTemplate(phone, templateName, params) {
  if (await isRateLimited(phone)) {
    console.log(`Rate-limited: skipping template "${templateName}" to ${maskPhone(phone)}`);
    return { skipped: true, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: (params && params.name) || '',
    templateParams: Array.isArray(params) ? params : (params && params.templateParams) || [],
  };

  try {
    const res = await fetch(AISENSY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await res.json();

    if (!res.ok) {
      console.error(`AiSensy error for ${maskPhone(phone)}:`, result);
      return { ok: false, error: result };
    }

    await logMessage(phone, 'out', `[template:${templateName}]`, templateName);
    return { ok: true, data: result };
  } catch (err) {
    console.error(`AiSensy request failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Send free-form text message via AiSensy
// ---------------------------------------------------------------------------
async function sendMessage(phone, body) {
  if (await isRateLimited(phone)) {
    console.log(`Rate-limited: skipping message to ${maskPhone(phone)}`);
    return { skipped: true, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_message',
    destination: phone,
    message: body,
  };

  try {
    const res = await fetch(AISENSY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await res.json();

    if (!res.ok) {
      console.error(`AiSensy error for ${maskPhone(phone)}:`, result);
      return { ok: false, error: result };
    }

    await logMessage(phone, 'out', body, null);
    return { ok: true, data: result };
  } catch (err) {
    console.error(`AiSensy request failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendTemplate, sendMessage, detectMarket };

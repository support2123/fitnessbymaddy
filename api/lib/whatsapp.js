const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

async function canSendMessage(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - RATE_LIMIT_MS).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return !data || data.length === 0;
}

async function sendTemplate(phone, templateName, params = []) {
  const db = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;

  if (!apiKey) {
    console.error(`[WA] No API key configured. Would send ${templateName} to ${maskPhone(phone)}`);
    return { success: false, error: 'no_api_key' };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation'
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const result = await res.json();

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: `[template: ${templateName}] ${params.join(', ')}`,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { success: res.ok, result };
  } catch (err) {
    console.error(`[WA] Send failed to ${maskPhone(phone)}:`, err.message);
    return { success: false, error: err.message };
  }
}

async function sendFreeform(phone, message) {
  const db = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;

  if (!apiKey) {
    console.error(`[WA] No API key. Would send freeform to ${maskPhone(phone)}`);
    return { success: false, error: 'no_api_key' };
  }

  const body = {
    apiKey,
    campaignName: 'freeform_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message,
    source: 'automation'
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: message,
      status: res.ok ? 'sent' : 'failed'
    });

    return { success: res.ok };
  } catch (err) {
    console.error(`[WA] Freeform failed to ${maskPhone(phone)}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendTemplate, sendFreeform, canSendMessage, detectMarket, maskPhone };

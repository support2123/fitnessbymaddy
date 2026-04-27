const { getSupabase } = require('./supabase');
const { maskPhone } = require('./pii');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function checkRateLimit(phone, isClient) {
  if (isClient) return true;
  const db = getSupabase();
  const { data } = await db
    .from('rate_limits')
    .select('last_sent_at')
    .eq('phone', phone)
    .single();

  if (data) {
    const elapsed = Date.now() - new Date(data.last_sent_at).getTime();
    if (elapsed < RATE_LIMIT_MS) return false;
  }
  return true;
}

async function updateRateLimit(phone) {
  const db = getSupabase();
  await db
    .from('rate_limits')
    .upsert({ phone, last_sent_at: new Date().toISOString() }, { onConflict: 'phone' });
}

async function sendTemplate(phone, templateName, params) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const allowed = await checkRateLimit(phone, false);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { sent: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();
  await updateRateLimit(phone);
  await logMessage(phone, 'out', params ? params.join(' | ') : templateName, templateName);

  return { sent: true, result };
}

async function sendSessionMessage(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const body = {
    apiKey,
    campaignName: 'session_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message: text,
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();
  await logMessage(phone, 'out', text, null);

  return { sent: true, result };
}

async function sendMediaMessage(phone, mediaUrl, caption) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const body = {
    apiKey,
    campaignName: 'media_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    media: { url: mediaUrl, filename: 'program.pdf' },
    message: caption || '',
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();
  await logMessage(phone, 'out', caption || '[PDF sent]', null);

  return { sent: true, result };
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body ? body.substring(0, 1000) : null,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

module.exports = {
  sendTemplate,
  sendSessionMessage,
  sendMediaMessage,
  logMessage,
  checkRateLimit,
};

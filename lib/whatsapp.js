import supabase from './supabase.js';

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

export async function sendWhatsApp(phone, body, templateName, bypassRateLimit = false) {
  if (!bypassRateLimit) {
    const canSend = await checkRateLimit(phone);
    if (!canSend) return { skipped: true, reason: 'rate_limited' };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  let result;

  if (templateName) {
    result = await sendTemplate(apiKey, phone, templateName);
  } else {
    result = await sendSession(apiKey, phone, body);
  }

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: body || `[template: ${templateName}]`,
    template_name: templateName,
    status: result.ok ? 'sent' : 'failed',
  });

  return result;
}

async function sendTemplate(apiKey, phone, templateName) {
  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKey,
        campaignName: templateName,
        destination: phone,
        userName: 'FitnessByMaddy',
        templateParams: [],
      }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.error('AiSensy template error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function sendSession(apiKey, phone, body) {
  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKey,
        campaignName: 'session_message',
        destination: phone,
        userName: 'FitnessByMaddy',
        message: { type: 'text', text: body },
      }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.error('AiSensy session error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function checkRateLimit(phone) {
  const since = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', since)
    .limit(1);
  return !data || data.length === 0;
}

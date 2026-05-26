const supabase = require('./supabase');
const { maskPhone } = require('./market');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function isOptedOut(phone) {
  const { data } = await supabase
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .eq('status', 'dropped')
    .limit(1);
  return data && data.length > 0;
}

async function isRateLimited(phone) {
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);
  return data && data.length > 0;
}

async function isActiveClient(phone) {
  const { data } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);
  return data && data.length > 0;
}

async function sendTemplate(phone, templateName, params, userName) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not set');
    return { ok: false, error: 'API key missing' };
  }

  if (await isOptedOut(phone)) {
    console.log(`Blocked: ${maskPhone(phone)} is opted out`);
    return { ok: false, error: 'opted_out' };
  }

  const isClient = await isActiveClient(phone);
  if (!isClient && await isRateLimited(phone)) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, error: 'rate_limited' };
  }

  try {
    const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        campaignName: templateName,
        destination: phone.replace('+', ''),
        userName: userName || 'FitnessByMaddy',
        templateParams: params || [],
        source: 'automation'
      })
    });

    const result = await res.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: `[Template: ${templateName}] ${(params || []).join(', ')}`,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok, data: result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: `[Template: ${templateName}] FAILED: ${err.message}`,
      template_name: templateName,
      status: 'failed'
    });
    return { ok: false, error: err.message };
  }
}

async function sendSessionMessage(phone, message) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { ok: false, error: 'API key missing' };

  if (await isOptedOut(phone)) return { ok: false, error: 'opted_out' };

  try {
    const res = await fetch('https://backend.aisensy.com/direct/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        campaignName: 'session_message',
        destination: phone.replace('+', ''),
        userName: 'FitnessByMaddy',
        message,
        source: 'automation'
      })
    });

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: message,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok };
  } catch (err) {
    console.error(`Session message failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function logIncoming(phone, body) {
  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body,
    status: 'received'
  });
}

module.exports = {
  sendTemplate,
  sendSessionMessage,
  logIncoming,
  isOptedOut,
  isRateLimited
};

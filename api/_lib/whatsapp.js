const { getSupabase } = require('./supabase');

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000;

function maskPhone(phone) {
  return '***' + phone.slice(-3);
}

async function isRateLimited(phone) {
  const supabase = getSupabase();

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();

  if (client) return false;

  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data: recent } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);

  return recent && recent.length > 0;
}

async function logMessage(phone, opts) {
  const supabase = getSupabase();
  await supabase.from('messages').insert({
    phone,
    direction: opts.direction,
    body: opts.body,
    template_name: opts.templateName || null,
    status: opts.status,
  });
}

async function sendTemplate(phone, templateName, params) {
  if (await isRateLimited(phone)) {
    console.log('Rate limited: skipping template "' + templateName + '" to ' + maskPhone(phone));
    return { skipped: true, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
  };

  try {
    const res = await fetch(AISENSY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await res.json();

    await logMessage(phone, {
      direction: 'out',
      body: '[template:' + templateName + '] ' + JSON.stringify(params),
      templateName,
      status: res.ok ? 'sent' : 'failed',
    });

    if (!res.ok) {
      console.error('Template send failed for ' + maskPhone(phone) + ':', result);
    }

    return result;
  } catch (err) {
    console.error('Template send error for ' + maskPhone(phone) + ':', err.message);
    await logMessage(phone, {
      direction: 'out',
      body: '[template:' + templateName + '] ' + JSON.stringify(params),
      templateName,
      status: 'error',
    });
    throw err;
  }
}

async function sendText(phone, text) {
  if (await isRateLimited(phone)) {
    console.log('Rate limited: skipping text to ' + maskPhone(phone));
    return { skipped: true, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: { type: 'text', text: text },
  };

  try {
    const res = await fetch(AISENSY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await res.json();

    await logMessage(phone, {
      direction: 'out',
      body: text,
      status: res.ok ? 'sent' : 'failed',
    });

    if (!res.ok) {
      console.error('Text send failed for ' + maskPhone(phone) + ':', result);
    }

    return result;
  } catch (err) {
    console.error('Text send error for ' + maskPhone(phone) + ':', err.message);
    await logMessage(phone, {
      direction: 'out',
      body: text,
      status: 'error',
    });
    throw err;
  }
}

module.exports = { sendTemplate, sendText };

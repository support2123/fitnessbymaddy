const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, body, params }) {
  const rateLimitOk = await checkRateLimit(phone);
  if (!rateLimitOk) {
    console.log(`Rate limited: ${phone.slice(0, 3)}XXX...${phone.slice(-3)}`);
    return { sent: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: params?.name || 'there',
    templateParams: params?.templateParams || [],
    source: 'fitnessbymaddy-automation',
    buttons: params?.buttons || []
  };

  if (body && !templateName) {
    payload.message = body;
  }

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    await logMessage({
      phone,
      direction: 'out',
      body: body || `template:${templateName}`,
      template_name: templateName || null,
      status: res.ok ? 'sent' : 'failed'
    });

    return { sent: res.ok, data };
  } catch (err) {
    console.error('WhatsApp send error:', err.message);
    await logMessage({
      phone,
      direction: 'out',
      body: body || `template:${templateName}`,
      template_name: templateName || null,
      status: 'error'
    });
    return { sent: false, error: err.message };
  }
}

async function checkRateLimit(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return !data || data.length === 0;
}

async function logMessage({ phone, direction, body, template_name, status }) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body?.substring(0, 1000),
    template_name,
    sent_at: new Date().toISOString(),
    status
  });
}

module.exports = { sendWhatsApp, logMessage, checkRateLimit };

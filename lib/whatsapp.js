const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, body, params }) {
  const db = getSupabase();

  const rateCheck = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .order('sent_at', { ascending: false })
    .limit(1);

  const isClient = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  const isOptedInClient = isClient.data && isClient.data.length > 0;

  if (!isOptedInClient && rateCheck.data && rateCheck.data.length > 0) {
    return { ok: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName || 'direct_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'automation',
    buttons: [],
  };

  if (body && !templateName) {
    payload.message = body;
  }

  let result;
  try {
    const resp = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    result = await resp.json();
  } catch (err) {
    result = { error: err.message };
  }

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || `template:${templateName}`,
    template_name: templateName || null,
    status: result.error ? 'failed' : 'sent',
  });

  return { ok: !result.error, result };
}

async function notifyMaddy(subject, details) {
  const maddyPhone = '+917082478374';
  await sendWhatsApp({
    phone: maddyPhone,
    body: `🚨 ESCALATION: ${subject}\n\n${details}`,
  });
}

module.exports = { sendWhatsApp, notifyMaddy };

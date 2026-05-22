const { supabase } = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, params = [], body = '' }) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('[WA] Missing AISENSY_API_KEY');
    return { ok: false, error: 'missing_api_key' };
  }

  const rateOk = await checkRateLimit(phone);
  if (!rateOk) {
    console.log(`[WA] Rate limited: ${maskPhone(phone)}`);
    return { ok: false, error: 'rate_limited' };
  }

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/\D/g, ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
  };

  if (body) {
    payload.message = body;
  }

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: body || `[template:${templateName}] ${params.join(', ')}`,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed',
    });

    return { ok: res.ok, data };
  } catch (err) {
    console.error(`[WA] Send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function checkRateLimit(phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();

  if (client) return true;

  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return (count || 0) < 1;
}

async function sendEscalationAlert(phone, reason, messageBody) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  await sendWhatsApp({
    phone: maddyPhone,
    templateName: 'escalation_alert',
    params: [maskPhone(phone), reason, (messageBody || '').slice(0, 200)],
  });
}

module.exports = { sendWhatsApp, sendEscalationAlert };

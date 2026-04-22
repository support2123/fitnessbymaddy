const { getSupabase } = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, params = {}, bodyText = '') {
  const supabase = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;

  if (!apiKey) {
    console.error('[WhatsApp] AISENSY_API_KEY not configured');
    return { ok: false, error: 'API key missing' };
  }

  const rateCheck = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .order('sent_at', { ascending: false })
    .limit(1);

  if (rateCheck.data && rateCheck.data.length > 0) {
    const isClient = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    if (!isClient.data || isClient.data.length === 0) {
      console.log(`[WhatsApp] Rate limited for ${maskPhone(phone)}`);
      return { ok: false, error: 'rate_limited' };
    }
  }

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    source: 'fitnessbymaddy-automation',
    buttons: params.buttons || []
  };

  try {
    const resp = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await resp.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: bodyText || templateName,
      template_name: templateName,
      status: resp.ok ? 'sent' : 'failed'
    });

    return { ok: resp.ok, data: result };
  } catch (err) {
    console.error(`[WhatsApp] Send failed for ${maskPhone(phone)}:`, err.message);

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: bodyText || templateName,
      template_name: templateName,
      status: 'error'
    });

    return { ok: false, error: err.message };
  }
}

async function notifyMaddy(subject, details) {
  const maddyPhone = '+917082478374';
  const msg = `🚨 ${subject}\n\n${details}`;

  return sendWhatsApp(maddyPhone, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [subject, details]
  }, msg);
}

module.exports = { sendWhatsApp, notifyMaddy };

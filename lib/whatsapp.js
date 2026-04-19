const { supabase } = require('./supabase');
const { maskPhone } = require('./utils');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, bodyParams, mediaUrl) {
  const rateOk = await checkRateLimit(phone);
  if (!rateOk) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: bodyParams || [],
  };
  if (mediaUrl) {
    payload.mediaUrl = mediaUrl;
    payload.mediaFilename = 'program.pdf';
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
      body: bodyParams ? bodyParams.join(' | ') : '',
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed',
    });

    return { ok: res.ok, data };
  } catch (err) {
    console.error(`WhatsApp send error for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function sendFreeformWhatsApp(phone, message) {
  const rateOk = await checkRateLimit(phone);
  if (!rateOk) return { ok: false, reason: 'rate_limited' };

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message,
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: message,
      template_name: 'freeform',
      status: res.ok ? 'sent' : 'failed',
    });

    return { ok: res.ok };
  } catch (err) {
    console.error(`WhatsApp freeform error for ${maskPhone(phone)}:`, err.message);
    return { ok: false, reason: err.message };
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
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return (count || 0) < 1;
}

async function notifyMaddy(subject, details) {
  const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [subject, details]);
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp, notifyMaddy };

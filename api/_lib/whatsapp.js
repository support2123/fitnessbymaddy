const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours
const MADDY_PHONE = '+917082478374';

async function sendTemplate(phone, templateName, params = []) {
  const rateLimited = await checkRateLimit(phone);
  if (rateLimited) {
    console.log(`Rate limited: ${maskPhone(phone)}, template: ${templateName}`);
    return { sent: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation'
  };

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: params.join(' | ') || templateName,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { sent: res.ok, data };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { sent: false, reason: err.message };
  }
}

async function sendFreeformMessage(phone, text) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_reply',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message: { text },
    source: 'automation'
  };

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: text,
      status: res.ok ? 'sent' : 'failed'
    });

    return { sent: res.ok };
  } catch (err) {
    console.error(`Freeform send failed for ${maskPhone(phone)}:`, err.message);
    return { sent: false, reason: err.message };
  }
}

async function notifyMaddy(subject, details) {
  return sendFreeformMessage(MADDY_PHONE, `ESCALATION: ${subject}\n\n${details}`);
}

async function checkRateLimit(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return false;

  const lastSent = new Date(data[0].sent_at).getTime();
  return Date.now() - lastSent < RATE_LIMIT_MS;
}

module.exports = { sendTemplate, sendFreeformMessage, notifyMaddy, checkRateLimit };

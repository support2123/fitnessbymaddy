const { supabase } = require('./supabase');
const { maskPhone } = require('./utils');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, bodyValues = [], mediaUrl = null) {
  const lastMsg = await getLastOutbound(phone);
  if (lastMsg) {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    if (new Date(lastMsg.sent_at).getTime() > twoHoursAgo) {
      console.log(`Rate limited: ${maskPhone(phone)} — last msg ${lastMsg.sent_at}`);
      return { rateLimited: true };
    }
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: bodyValues,
  };
  if (mediaUrl) payload.mediaUrl = mediaUrl;

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: bodyValues.join(' | '),
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return data;
}

async function sendFreeformWhatsApp(phone, message) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message,
  };

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

  return res.json();
}

async function getLastOutbound(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();
  return data;
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp };

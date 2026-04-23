const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function canSendMessage(phone, isClient) {
  if (isClient) return true;
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase()
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);
  return (count || 0) === 0;
}

async function sendTemplate(phone, templateName, params = []) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params,
      source: 'automation',
      buttons: [],
    }),
  });

  const result = await res.json();

  await supabase().from('messages').insert({
    phone,
    direction: 'out',
    body: `Template: ${templateName} | Params: ${JSON.stringify(params)}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return result;
}

async function sendFreeform(phone, body) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'freeform_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: body,
      source: 'automation',
    }),
  });

  await supabase().from('messages').insert({
    phone,
    direction: 'out',
    body,
    status: res.ok ? 'sent' : 'failed',
  });

  return res.json();
}

async function logIncoming(phone, body) {
  await supabase().from('messages').insert({
    phone,
    direction: 'in',
    body,
    status: 'received',
  });
}

module.exports = { sendTemplate, sendFreeform, logIncoming, canSendMessage };

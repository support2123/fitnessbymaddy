import supabase from './supabase.js';

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

export async function sendTemplate(phone, templateName, params = []) {
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
    }),
  });

  const data = await res.json();

  await supabase.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'out',
    body: params.join(' | '),
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return data;
}

export async function sendText(phone, message) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message,
    }),
  });

  const data = await res.json();

  await supabase.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'out',
    body: message,
    status: res.ok ? 'sent' : 'failed',
  });

  return data;
}

export async function canSendMessage(phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', maskPhone(phone))
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return (count || 0) === 0;
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return phone;
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

export { maskPhone };

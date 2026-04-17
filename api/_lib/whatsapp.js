const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, body, params = [], mediaUrl }) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: recentMsg } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  const isClient = client && client.length > 0;

  if (recentMsg && recentMsg.length > 0 && !isClient) {
    return { rateLimited: true };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
    media: mediaUrl ? { url: mediaUrl, filename: 'program.pdf' } : {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  const response = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: body || `Template: ${templateName}`,
    template_name: templateName,
    status: response.ok ? 'sent' : 'failed'
  });

  return { ok: response.ok, ...result };
}

async function sendSessionMessage({ phone, text }) {
  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    template_name: null,
    status: 'sent'
  });

  const response = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'session_message',
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      templateParams: [text],
      source: 'automation',
      media: {},
      buttons: [],
      carouselCards: [],
      location: {}
    })
  });

  return response.json();
}

module.exports = { sendWhatsApp, sendSessionMessage };

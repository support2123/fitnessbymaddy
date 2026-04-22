const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendToLead(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return true;
  const lastSent = new Date(data[0].sent_at).getTime();
  return Date.now() - lastSent >= RATE_LIMIT_MS;
}

async function sendTemplate(phone, templateName, params = []) {
  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AiSensy-Project-API-Pwd': process.env.AISENSY_API_KEY
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      templateParams: params,
      media: {}
    })
  });

  const result = await resp.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `Template: ${templateName} | Params: ${JSON.stringify(params)}`,
    template_name: templateName,
    status: resp.ok ? 'sent' : 'failed'
  });

  return result;
}

async function sendText(phone, text) {
  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AiSensy-Project-API-Pwd': process.env.AISENSY_API_KEY
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'session_reply',
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      message: text
    })
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: resp.ok ? 'sent' : 'failed'
  });

  return resp.ok;
}

async function sendMediaMessage(phone, mediaUrl, caption) {
  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AiSensy-Project-API-Pwd': process.env.AISENSY_API_KEY
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'media_send',
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      media: { url: mediaUrl, filename: 'program.pdf' },
      message: caption || ''
    })
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: caption || `[PDF] ${mediaUrl}`,
    status: resp.ok ? 'sent' : 'failed'
  });

  return resp.ok;
}

module.exports = { sendTemplate, sendText, sendMediaMessage, canSendToLead };

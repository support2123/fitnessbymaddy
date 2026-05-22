import supabase from './supabase.js';

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const AISENSY_KEY = process.env.AISENSY_API_KEY;
const MADDY_PHONE = '917082478374';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

export async function sendTemplate(phone, templateName, params = []) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AISENSY_KEY}`
    },
    body: JSON.stringify({
      apiKey: AISENSY_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params,
      source: 'automation',
      buttons: []
    })
  });

  const data = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `Template: ${templateName} | Params: ${JSON.stringify(params)}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  if (!res.ok) {
    console.error(`WhatsApp send failed to ${maskPhone(phone)}:`, data);
  }

  return { ok: res.ok, data };
}

export async function sendText(phone, text) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AISENSY_KEY}`
    },
    body: JSON.stringify({
      apiKey: AISENSY_KEY,
      campaignName: 'text_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: { text },
      source: 'automation'
    })
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok };
}

export async function sendMediaMessage(phone, mediaUrl, caption) {
  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AISENSY_KEY}`
    },
    body: JSON.stringify({
      apiKey: AISENSY_KEY,
      campaignName: 'media_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      media: { url: mediaUrl, filename: 'program.pdf' },
      message: { text: caption || '' },
      source: 'automation'
    })
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[PDF] ${caption || mediaUrl}`,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok };
}

export async function notifyMaddy(subject, details) {
  await sendText(MADDY_PHONE, `*ESCALATION*\n${subject}\n\n${details}`);
}

export function canSendMessage(lastMsgAt) {
  if (!lastMsgAt) return true;
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  return new Date(lastMsgAt).getTime() < twoHoursAgo;
}

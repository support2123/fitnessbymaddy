const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_BASE = 'https://backend.aisensy.com';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendMessage(phone, isClient) {
  if (isClient) return true;
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

async function sendTemplate(phone, templateName, params, userName) {
  const apiKey = process.env.AISENSY_API_KEY;
  const res = await fetch(`${AISENSY_BASE}/campaign/t1/api/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: templateName,
      destination: phone,
      userName: userName || 'there',
      templateParams: params || [],
      source: 'automation',
      media: {},
    }),
  });
  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[template: ${templateName}] ${(params || []).join(', ')}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  if (!res.ok) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, result);
  }
  return { ok: res.ok, result };
}

async function sendText(phone, body) {
  const apiKey = process.env.AISENSY_API_KEY;
  const res = await fetch(`${AISENSY_BASE}/direct-apis/t1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AiSensy-Project-API-Key': apiKey,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body },
    }),
  });
  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body,
    status: res.ok ? 'sent' : 'failed',
  });

  if (!res.ok) {
    console.error(`WhatsApp text failed for ${maskPhone(phone)}:`, result);
  }
  return { ok: res.ok, result };
}

async function sendDocument(phone, pdfUrl, caption) {
  const apiKey = process.env.AISENSY_API_KEY;
  const res = await fetch(`${AISENSY_BASE}/direct-apis/t1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AiSensy-Project-API-Key': apiKey,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'document',
      document: { link: pdfUrl, caption },
    }),
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[PDF] ${caption}`,
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok };
}

module.exports = { canSendMessage, sendTemplate, sendText, sendDocument };

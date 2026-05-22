const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendToLead(phone) {
  const sb = getSupabase();
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data } = await sb
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);
  return !data || data.length === 0;
}

async function sendTemplate(phone, templateName, params = {}) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/[^0-9]/g, ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    source: 'automation',
    media: params.media || {},
    buttons: params.buttons || [],
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();

  await logMessage(phone, 'out', `[template:${templateName}]`, templateName);

  if (!res.ok) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, result);
  }

  return result;
}

async function sendText(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const body = {
    apiKey,
    campaignName: 'text_message',
    destination: phone.replace(/[^0-9]/g, ''),
    message: text,
    source: 'automation',
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  await logMessage(phone, 'out', text, null);
  return res.json();
}

async function logMessage(phone, direction, body, templateName) {
  const sb = getSupabase();
  await sb.from('messages').insert({
    phone,
    direction,
    body: body?.slice(0, 2000),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

async function sendMediaTemplate(phone, templateName, pdfUrl, params = {}) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/[^0-9]/g, ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    source: 'automation',
    media: {
      url: pdfUrl,
      filename: params.filename || 'program.pdf',
    },
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  await logMessage(phone, 'out', `[media:${templateName}] ${pdfUrl}`, templateName);
  return res.json();
}

module.exports = {
  sendTemplate,
  sendText,
  sendMediaTemplate,
  logMessage,
  canSendToLead,
};

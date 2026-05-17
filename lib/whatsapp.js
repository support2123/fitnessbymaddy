const { supabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function canSendMessage(phone, isClient) {
  if (isClient) return true;
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);
  return (count || 0) === 0;
}

async function sendTemplate(phone, templateName, params = {}) {
  const allowed = await canSendMessage(phone, false);
  if (!allowed) return { ok: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: params.name || '',
    templateParams: params.templateParams || [],
    media: params.media || {}
  };

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[template: ${templateName}]`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok, data: result };
}

async function sendText(phone, text, isClient = false) {
  const allowed = await canSendMessage(phone, isClient);
  if (!allowed) return { ok: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone,
    message: text
  };

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok, data: result };
}

async function sendMedia(phone, mediaUrl, caption, isClient = false) {
  const allowed = await canSendMessage(phone, isClient);
  if (!allowed) return { ok: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'media_message',
    destination: phone,
    media: {
      url: mediaUrl,
      filename: 'program.pdf'
    },
    templateParams: [caption]
  };

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[media: ${mediaUrl}] ${caption}`,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok, data: result };
}

module.exports = { sendTemplate, sendText, sendMedia };

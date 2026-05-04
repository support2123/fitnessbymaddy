const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendToLead(phone) {
  const db = getSupabase();
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data } = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .order('sent_at', { ascending: false })
    .limit(1);
  return !data || data.length === 0;
}

async function sendTemplate(phone, templateName, params = []) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params,
      source: 'automation',
      media: {},
    }),
  });

  const result = await res.json();

  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: `Template: ${templateName}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  if (!res.ok) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, result);
  }

  return result;
}

async function sendText(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: 'text_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: text,
      source: 'automation',
    }),
  });

  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: res.ok ? 'sent' : 'failed',
  });

  return res.json();
}

async function sendMediaMessage(phone, mediaUrl, caption) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: 'media_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      media: { url: mediaUrl, filename: 'program.pdf' },
      message: caption || '',
      source: 'automation',
    }),
  });

  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: caption || `[PDF: ${mediaUrl}]`,
    status: res.ok ? 'sent' : 'failed',
  });

  return res.json();
}

module.exports = { sendTemplate, sendText, sendMediaMessage, canSendToLead };

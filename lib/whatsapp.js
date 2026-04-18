const { getClient } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params = []) {
  const resp = await fetch(AISENSY_BASE, {
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

  const data = await resp.json();

  const db = getClient();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: params.join(' | '),
    template_name: templateName,
    status: resp.ok ? 'sent' : 'failed',
  });

  return { ok: resp.ok, data };
}

async function sendText(phone, text) {
  const resp = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: text,
    }),
  });

  const data = await resp.json();

  const db = getClient();
  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    template_name: null,
    status: resp.ok ? 'sent' : 'failed',
  });

  return { ok: resp.ok, data };
}

async function canSendToLead(phone) {
  const db = getClient();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return !data || data.length === 0;
}

module.exports = { sendTemplate, sendText, canSendToLead };

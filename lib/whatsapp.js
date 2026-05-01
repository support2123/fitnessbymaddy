const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

async function sendTemplate(phone, templateName, params) {
  const db = getSupabase();

  const recentMsg = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();

  if (recentMsg.data) {
    const diff = Date.now() - new Date(recentMsg.data.sent_at).getTime();
    const isClient = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (!isClient.data && diff < 2 * 60 * 60 * 1000) {
      console.log(`Rate limited: ${maskPhone(phone)}, last msg ${Math.round(diff / 60000)}m ago`);
      return { rateLimited: true };
    }
  }

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params || [],
    }),
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: params ? params.join(' | ') : templateName,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return result;
}

async function sendText(phone, text) {
  const db = getSupabase();

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: text,
    }),
  });

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: res.ok ? 'sent' : 'failed',
  });

  return res.json();
}

async function notifyMaddy(subject, details) {
  const MADDY_PHONE = '917082478374';
  const msg = `[ESCALATION] ${subject}\n${details}`;
  return sendText(MADDY_PHONE, msg);
}

module.exports = { sendTemplate, sendText, notifyMaddy, maskPhone };

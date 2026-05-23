const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, params = [], message }) {
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
    const lastSent = new Date(recentMsg.data.sent_at);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const isClient = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (lastSent > twoHoursAgo && !isClient.data) {
      return { throttled: true };
    }
  }

  const payload = templateName
    ? {
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: templateName,
        destination: phone.replace(/^\+/, ''),
        userName: params[0] || 'there',
        templateParams: params,
      }
    : {
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: 'session_message',
        destination: phone.replace(/^\+/, ''),
        message: message,
      };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: message || `Template: ${templateName}`,
    template_name: templateName || null,
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok, result };
}

module.exports = { sendWhatsApp };

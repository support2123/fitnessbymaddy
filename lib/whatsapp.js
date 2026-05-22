const { getSupabase } = require('./supabase');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendWhatsApp({ phone, templateName, body, params, isClient }) {
  const db = getSupabase();

  if (!isClient) {
    const { data: recent } = await db
      .from('messages')
      .select('sent_at')
      .eq('phone', phone)
      .eq('direction', 'out')
      .order('sent_at', { ascending: false })
      .limit(1);

    if (recent && recent.length > 0) {
      const elapsed = Date.now() - new Date(recent[0].sent_at).getTime();
      if (elapsed < RATE_LIMIT_MS) {
        return { rateLimited: true };
      }
    }
  }

  const apiKey = process.env.AISENSY_API_KEY;
  const payload = {
    apiKey,
    campaignName: templateName || 'direct_message',
    destination: phone.replace(/\D/g, ''),
    userName: params?.name || 'there',
    templateParams: params?.templateParams || [],
    message: body || ''
  };

  const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || templateName,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok, result };
}

async function logIncoming(phone, body) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body
  });
}

module.exports = { sendWhatsApp, logIncoming };

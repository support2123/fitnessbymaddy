const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendWhatsApp({ phone, templateName, bodyValues, mediaUrl }) {
  const db = getSupabase();

  const isTemplate = !!templateName;

  if (isTemplate) {
    const { data: recent } = await db
      .from('messages')
      .select('sent_at')
      .eq('phone', phone)
      .eq('direction', 'out')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    if (recent && Date.now() - new Date(recent.sent_at).getTime() < RATE_LIMIT_MS) {
      const { data: client } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .single();

      if (!client) {
        console.log(`Rate limited: ${maskPhone(phone)}`);
        return { rateLimited: true };
      }
    }
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName || 'session_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: bodyValues || [],
  };

  if (mediaUrl) {
    payload.mediaUrl = mediaUrl;
    payload.mediaFilename = 'program.pdf';
  }

  const res = await fetch(`${AISENSY_API}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: bodyValues ? bodyValues.join(' | ') : templateName,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return { ok: res.ok, result };
}

async function logIncomingMessage(phone, body) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body,
  });
}

module.exports = { sendWhatsApp, logIncomingMessage };

const { getSupabase } = require('./supabase');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendMessage(phone, isClient = false) {
  if (isClient) return true;

  const db = getSupabase();
  const since = new Date(Date.now() - RATE_LIMIT_MS).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', since)
    .limit(1);

  return !data || data.length === 0;
}

async function logMessage(phone, direction, body, templateName = null) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body?.substring(0, 2000),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

module.exports = { canSendMessage, logMessage };

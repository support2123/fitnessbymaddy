const { getSupabase } = require('./supabase');

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

async function canSendMessage(phone, isClient = false) {
  if (isClient) return true;

  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - TWO_HOURS_MS).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return !data || data.length === 0;
}

async function logMessage(phone, direction, body, templateName = null) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

module.exports = { canSendMessage, logMessage };

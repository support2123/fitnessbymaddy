const { getSupabase } = require('./supabase');

async function logMessage(phone, direction, body, templateName = null) {
  const db = getSupabase();
  const { error } = await db.from('messages').insert({
    phone,
    direction,
    body: body ? body.substring(0, 2000) : null,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
  if (error) console.error('logMessage error:', error.message);
}

async function canSendMessage(phone) {
  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (client) return true;

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return !recent || recent.length === 0;
}

async function isOptedOut(phone) {
  const db = getSupabase();
  const { data } = await db
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .eq('status', 'dropped')
    .limit(1);

  return data && data.length > 0;
}

module.exports = { logMessage, canSendMessage, isOptedOut };

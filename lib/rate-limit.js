const { getClient } = require('./supabase');

async function canSendMessage(phone) {
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

async function logMessage(phone, direction, body, templateName) {
  const db = getClient();
  await db.from('messages').insert({
    phone,
    direction,
    body: (body || '').slice(0, 2000),
    template_name: templateName || null,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

module.exports = { canSendMessage, logMessage };

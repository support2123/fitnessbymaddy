const { getClient } = require('./supabase');

async function logMessage(phone, direction, body, templateName = null) {
  const sb = getClient();
  const { error } = await sb.from('messages').insert({
    phone,
    direction,
    body: body.slice(0, 2000),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
  if (error) console.error('[MSG_LOG]', error.message);
}

async function canSendTo(phone) {
  const sb = getClient();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);
  return !data || data.length === 0;
}

async function isOptedOut(phone) {
  const sb = getClient();
  const { data } = await sb
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .eq('status', 'dropped')
    .limit(1);
  if (data && data.length > 0) return true;
  const { data: clients } = await sb
    .from('clients')
    .select('status')
    .eq('phone', phone)
    .in('status', ['refunded'])
    .limit(1);
  return clients && clients.length > 0;
}

module.exports = { logMessage, canSendTo, isOptedOut };

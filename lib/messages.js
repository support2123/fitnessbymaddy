const { getSupabase } = require('./supabase');

async function logMessage(phone, direction, body, templateName = null) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body ? body.slice(0, 2000) : '',
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

async function canSendTo(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  if (data && data.length > 0) {
    const { data: clientData } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    return clientData && clientData.length > 0;
  }

  return true;
}

module.exports = { logMessage, canSendTo };

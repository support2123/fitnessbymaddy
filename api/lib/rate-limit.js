const { getSupabase } = require('./supabase');

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

async function canSendTo(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - TWO_HOURS_MS).toISOString();

  const { data } = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .order('sent_at', { ascending: false })
    .limit(1);

  return !data || data.length === 0;
}

async function isOptedIn(phone) {
  const db = getSupabase();
  const { data } = await db
    .from('clients')
    .select('status')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  return data && data.length > 0;
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: body.slice(0, 1000),
    template_name: templateName || null,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

module.exports = { canSendTo, isOptedIn, logMessage };

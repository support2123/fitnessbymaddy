const { getSupabase } = require('./supabase');

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

async function canSendTo(phone, isClient = false) {
  if (isClient) return true;

  const db = getSupabase();
  const since = new Date(Date.now() - TWO_HOURS_MS).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', since)
    .limit(1);

  return !data || data.length === 0;
}

module.exports = { canSendTo };

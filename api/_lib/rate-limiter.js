const { getSupabase } = require('./supabase');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendTo(phone) {
  const db = getSupabase();
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();

  const { data } = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .order('sent_at', { ascending: false })
    .limit(1);

  return !data || data.length === 0;
}

module.exports = { canSendTo };

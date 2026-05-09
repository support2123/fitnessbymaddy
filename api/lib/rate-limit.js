const { getSupabase } = require('./supabase');

const RATE_LIMIT_HOURS = 2;

async function canSendToLead(phone) {
  const db = getSupabase();
  const cutoff = new Date(Date.now() - RATE_LIMIT_HOURS * 60 * 60 * 1000).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);

  return !data || data.length === 0;
}

async function isOptedOut(phone) {
  const db = getSupabase();
  const { data } = await db
    .from('leads')
    .select('opted_out')
    .eq('phone', phone)
    .single();

  return data?.opted_out === true;
}

module.exports = { canSendToLead, isOptedOut };

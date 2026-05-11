const { getClient } = require('./supabase');

const RATE_LIMIT_HOURS = 2;

async function canSendMessage(phone, isClient) {
  if (isClient) return true;

  const sb = getClient();
  const cutoff = new Date(Date.now() - RATE_LIMIT_HOURS * 60 * 60 * 1000).toISOString();

  const { data } = await sb
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);

  return !data || data.length === 0;
}

module.exports = { canSendMessage };

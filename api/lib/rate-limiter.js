const { supabase } = require('./supabase');

const RATE_LIMIT_HOURS = 2;

async function canSendTo(phone, isClient = false) {
  if (isClient) return true;

  const since = new Date(Date.now() - RATE_LIMIT_HOURS * 60 * 60 * 1000).toISOString();

  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', since);

  return (count || 0) === 0;
}

module.exports = { canSendTo };

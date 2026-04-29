const { getSupabase } = require('./supabase');

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

async function canSendMessage(phone, isClient = false) {
  if (isClient) return true;

  const supabase = getSupabase();
  const twoHoursAgo = new Date(Date.now() - TWO_HOURS_MS).toISOString();

  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return !data || data.length === 0;
}

async function logMessage(phone, direction, body, templateName, status = 'sent') {
  const supabase = getSupabase();
  await supabase.from('messages').insert({
    phone,
    direction,
    body: body ? body.substring(0, 2000) : null,
    template_name: templateName || null,
    status
  });
}

module.exports = { canSendMessage, logMessage };

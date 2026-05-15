const { getSupabase } = require('./supabase');

async function canSendMessage(phone) {
  const supabase = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return !data || data.length === 0;
}

async function logMessage(phone, direction, body, templateName) {
  const supabase = getSupabase();
  await supabase.from('messages').insert({
    phone,
    direction,
    body: body?.substring(0, 2000),
    template_name: templateName,
  });
}

module.exports = { canSendMessage, logMessage };

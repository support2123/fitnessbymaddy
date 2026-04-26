const { supabase } = require('./supabase');

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

async function canSendMessage(phone, isClient = false) {
  if (isClient) return true;

  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return true;

  const lastSent = new Date(data[0].sent_at).getTime();
  return Date.now() - lastSent >= TWO_HOURS_MS;
}

async function logMessage(phone, direction, body, templateName = null) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body: body.substring(0, 2000),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

module.exports = { canSendMessage, logMessage };

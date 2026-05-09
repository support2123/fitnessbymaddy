const { getSupabase } = require('./supabase');

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

async function canSendToLead(phone) {
  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - TWO_HOURS_MS).toISOString();

  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);

  return !data || data.length === 0;
}

async function logMessage(phone, direction, body, templateName) {
  const supabase = getSupabase();
  await supabase.from('messages').insert({
    phone,
    direction,
    body: body || '',
    template_name: templateName || null,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

module.exports = { canSendToLead, logMessage };

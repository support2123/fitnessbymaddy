import supabase from './supabase.js';

const RATE_LIMIT_HOURS = 2;

export async function canSendMessage(phone) {
  const cutoff = new Date(Date.now() - RATE_LIMIT_HOURS * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);

  return !data || data.length === 0;
}

export async function logMessage(phone, direction, body, templateName = null) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body: (body || '').slice(0, 2000),
    template_name: templateName,
  });
}

export async function isOptedOut(phone) {
  const { data } = await supabase
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .single();

  return data?.status === 'dropped';
}

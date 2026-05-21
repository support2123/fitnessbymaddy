const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendToLead(supabase, phone) {
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .order('sent_at', { ascending: false })
    .limit(1);

  return !data || data.length === 0;
}

async function isOptedOut(supabase, phone) {
  const { data } = await supabase
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .single();

  return data && data.status === 'dropped';
}

async function sendTemplate(supabase, phone, templateName, params) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not set');

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: params.name || 'there',
    templateParams: Object.values(params).map(String)
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[template: ${templateName}]`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return result;
}

async function sendText(supabase, phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not set');

  const payload = {
    apiKey,
    campaignName: 'text_message',
    destination: phone.replace('+', ''),
    message: text
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: res.ok ? 'sent' : 'failed'
  });

  return res.ok;
}

async function sendRateLimited(supabase, phone, templateName, params, isClient) {
  if (!isClient) {
    const optedOut = await isOptedOut(supabase, phone);
    if (optedOut) return { skipped: true, reason: 'opted_out' };

    const canSend = await canSendToLead(supabase, phone);
    if (!canSend) return { skipped: true, reason: 'rate_limited' };
  }

  return sendTemplate(supabase, phone, templateName, params);
}

module.exports = {
  sendTemplate,
  sendText,
  sendRateLimited,
  canSendToLead,
  isOptedOut
};

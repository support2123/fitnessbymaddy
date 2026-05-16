const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, params = {}) {
  const supabase = getSupabase();

  const recentMsg = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();

  if (recentMsg.data) {
    const lastSent = new Date(recentMsg.data.sent_at);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    if (lastSent > twoHoursAgo) {
      const isClient = await supabase
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .single();

      if (!isClient.data) {
        return { skipped: true, reason: 'rate_limited' };
      }
    }
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    source: 'fitnessbymaddy-automation',
    media: params.media || undefined,
    buttons: params.buttons || undefined
  };

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone: phone,
    direction: 'out',
    body: templateName,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed'
  });

  return { sent: res.ok, result };
}

async function logIncoming(phone, body) {
  const supabase = getSupabase();
  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body,
    sent_at: new Date().toISOString(),
    status: 'received'
  });
}

module.exports = { sendWhatsApp, logIncoming };

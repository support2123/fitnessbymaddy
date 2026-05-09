const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, message, templateName) {
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
    const elapsed = Date.now() - new Date(recentMsg.data.sent_at).getTime();
    const twoHours = 2 * 60 * 60 * 1000;
    const isClient = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (elapsed < twoHours && !isClient.data) {
      return { rateLimited: true };
    }
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName || 'direct_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message,
  };

  if (templateName) {
    payload.templateParams = [message];
  }

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: message,
    template_name: templateName || null,
    status: res.ok ? 'sent' : 'failed',
  });

  return { sent: res.ok, result };
}

async function logInbound(phone, body) {
  const supabase = getSupabase();
  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body,
    status: 'received',
  });
}

module.exports = { sendWhatsApp, logInbound };

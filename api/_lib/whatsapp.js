const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendWhatsApp({ phone, templateName, body, params }) {
  const supabase = getSupabase();

  const rateLimited = await checkRateLimit(supabase, phone);
  if (rateLimited) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { sent: false, reason: 'rate_limited' };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const payload = {
    apiKey,
    campaignName: templateName || 'direct_message',
    destination: phone.replace(/^\+/, ''),
    userName: params?.name || 'there',
    templateParams: params?.templateParams || [],
    source: 'fitnessbymaddy-automation',
    media: {},
  };

  if (body && !templateName) {
    payload.message = body;
  }

  const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: body || `template:${templateName}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return { sent: res.ok, result };
}

async function checkRateLimit(supabase, phone) {
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();

  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);

  return data && data.length > 0;
}

async function sendWhatsAppDirect({ phone, body }) {
  return sendWhatsApp({ phone, body });
}

module.exports = { sendWhatsApp, sendWhatsAppDirect };

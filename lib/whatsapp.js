const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function checkRateLimit(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    const lastSent = new Date(data[0].sent_at).getTime();
    if (Date.now() - lastSent < RATE_LIMIT_MS) return false;
  }
  return true;
}

async function sendTemplate(phone, templateName, params = [], skipRateLimit = false) {
  if (!skipRateLimit) {
    const allowed = await checkRateLimit(phone);
    if (!allowed) {
      console.log(`Rate limited: ${maskPhone(phone)}, template: ${templateName}`);
      return { success: false, reason: 'rate_limited' };
    }
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/[^0-9]/g, ''),
    userName: params[0] || 'there',
    templateParams: params,
  };

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[template: ${templateName}] ${params.join(', ')}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return { success: res.ok, data: result };
}

async function sendText(phone, text, skipRateLimit = false) {
  if (!skipRateLimit) {
    const allowed = await checkRateLimit(phone);
    if (!allowed) {
      console.log(`Rate limited: ${maskPhone(phone)}, text message`);
      return { success: false, reason: 'rate_limited' };
    }
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const payload = {
    apiKey,
    campaignName: 'text_message',
    destination: phone.replace(/[^0-9]/g, ''),
    message: text,
    type: 'text',
  };

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: res.ok ? 'sent' : 'failed',
  });

  return { success: res.ok, data: result };
}

async function logIncoming(phone, body) {
  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body,
    status: 'received',
  });
}

module.exports = { sendTemplate, sendText, logIncoming, checkRateLimit };

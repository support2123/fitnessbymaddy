const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function checkRateLimit(phone, isClient) {
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
  return Date.now() - lastSent >= RATE_LIMIT_MS;
}

async function sendTemplate(phone, templateName, params) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: templateName,
      destination: phone.replace(/^\+/, ''),
      userName: 'FitnessByMaddy',
      templateParams: params || []
    })
  });

  const result = await res.json();
  await logMessage(phone, 'out', `[Template: ${templateName}] ${(params || []).join(', ')}`, templateName);
  return result;
}

async function sendText(phone, body) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: 'text_message',
      destination: phone.replace(/^\+/, ''),
      userName: 'FitnessByMaddy',
      message: { type: 'text', text: body }
    })
  });

  const result = await res.json();
  await logMessage(phone, 'out', body, null);
  return result;
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body: body ? body.substring(0, 2000) : null,
    template_name: templateName,
    status: 'sent'
  });
}

module.exports = { sendTemplate, sendText, logMessage, checkRateLimit };

const supabase = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendTemplate(phone, templateName, params, mediaUrl) {
  if (!(await canSendToLead(phone))) return { skipped: true, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'automation'
  };
  if (mediaUrl) {
    body.media = { url: mediaUrl, filename: 'program.pdf' };
  }

  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  await logMessage(phone, 'out', `[template:${templateName}] ${(params || []).join(', ')}`, templateName);
  return data;
}

async function sendText(phone, text) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: { type: 'text', text },
    source: 'automation'
  };

  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  await logMessage(phone, 'out', text, null);
  return data;
}

async function canSendToLead(phone) {
  const { data: lead } = await supabase
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .single();

  if (lead && lead.status === 'dropped') return false;

  const { data: client } = await supabase
    .from('clients')
    .select('status')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  // Active clients are not rate-limited
  if (client) return true;

  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff);

  return (count || 0) === 0;
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body: (body || '').slice(0, 2000),
    template_name: templateName,
    sent_at: new Date().toISOString()
  });
}

module.exports = { sendTemplate, sendText, canSendToLead, logMessage };

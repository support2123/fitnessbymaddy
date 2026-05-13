const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendToLead(phone) {
  const { data } = await getSupabase()
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

async function isOptedOut(phone) {
  const { data } = await getSupabase()
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .single();

  return data?.status === 'dropped';
}

async function isActiveClient(phone) {
  const { data } = await getSupabase()
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  return data && data.length > 0;
}

async function sendTemplate(phone, templateName, params, userName) {
  const optedOut = await isOptedOut(phone);
  if (optedOut) {
    console.log(`Blocked: ${maskPhone(phone)} opted out`);
    return { blocked: true, reason: 'opted_out' };
  }

  const isClient = await isActiveClient(phone);
  if (!isClient) {
    const allowed = await canSendToLead(phone);
    if (!allowed) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { blocked: true, reason: 'rate_limited' };
    }
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: userName || 'there',
    templateParams: params || [],
    source: 'automation'
  };

  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await resp.json();

  await getSupabase().from('messages').insert({
    phone,
    direction: 'out',
    body: `[template: ${templateName}] ${(params || []).join(', ')}`,
    template_name: templateName,
    status: resp.ok ? 'sent' : 'failed'
  });

  return { sent: resp.ok, result };
}

async function sendTextMessage(phone, text) {
  const optedOut = await isOptedOut(phone);
  if (optedOut) return { blocked: true, reason: 'opted_out' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'session_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'there',
    templateParams: [text],
    source: 'automation'
  };

  const resp = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  await getSupabase().from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: resp.ok ? 'sent' : 'failed'
  });

  return { sent: resp.ok };
}

async function notifyMaddy(subject, details) {
  const maddyPhone = '+917082478374';
  const text = `🚨 ${subject}\n${details}`;
  await sendTextMessage(maddyPhone, text);

  if (process.env.RESEND_API_KEY) {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'FitnessByMaddy Bot <support@fitnessbymaddy.com>',
      to: 'support@fitnessbymaddy.com',
      subject: `[Escalation] ${subject}`,
      text: details
    }).catch(() => {});
  }
}

module.exports = {
  sendTemplate,
  sendTextMessage,
  notifyMaddy,
  canSendToLead,
  isOptedOut,
  isActiveClient
};

const supabase = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '+917082478374';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

async function canSendToLead(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return true;

  const lastSent = new Date(data[0].sent_at);
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  return lastSent < twoHoursAgo;
}

async function isOptedOut(phone) {
  const { data } = await supabase
    .from('leads')
    .select('opted_out')
    .eq('phone', phone)
    .single();

  return data?.opted_out === true;
}

async function sendTemplate(phone, templateName, params = {}) {
  if (await isOptedOut(phone)) {
    console.log(`Blocked: ${maskPhone(phone)} opted out`);
    return { blocked: true, reason: 'opted_out' };
  }

  const isClient = await checkIsClient(phone);
  if (!isClient && !(await canSendToLead(phone))) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { blocked: true, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    media: params.media || {}
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[Template: ${templateName}]`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return result;
}

async function sendTextMessage(phone, body) {
  if (await isOptedOut(phone)) {
    return { blocked: true, reason: 'opted_out' };
  }

  const isClient = await checkIsClient(phone);
  if (!isClient && !(await canSendToLead(phone))) {
    return { blocked: true, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone.replace('+', ''),
    message: body
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body,
    status: res.ok ? 'sent' : 'failed'
  });

  return res.json();
}

async function notifyMaddy(subject, details) {
  await sendTextMessage(MADDY_PHONE, `🚨 ${subject}\n\n${details}`);
}

async function checkIsClient(phone) {
  const { data } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  return data && data.length > 0;
}

module.exports = { sendTemplate, sendTextMessage, notifyMaddy, maskPhone, canSendToLead, isOptedOut };

const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '917082478374';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith('91') || phone.startsWith('+91')) return 'IN';
  if (phone.startsWith('971') || phone.startsWith('+971')) return 'UAE';
  if (phone.startsWith('44') || phone.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}

async function sendTemplate(phone, templateName, params = []) {
  const db = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const cleanPhone = phone.replace(/[^0-9]/g, '');

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: cleanPhone,
    userName: 'FitnessByMaddy',
    templateParams: params,
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone: cleanPhone,
    direction: 'out',
    body: params.join(' | '),
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed',
  });

  return result;
}

async function sendFreeform(phone, message) {
  const db = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const cleanPhone = phone.replace(/[^0-9]/g, '');

  const payload = {
    apiKey,
    campaignName: 'freeform_message',
    destination: cleanPhone,
    userName: 'FitnessByMaddy',
    message,
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  await db.from('messages').insert({
    phone: cleanPhone,
    direction: 'out',
    body: message,
    status: res.ok ? 'sent' : 'failed',
  });

  return res.json();
}

async function canSendMessage(phone) {
  const db = getSupabase();
  const cleanPhone = phone.replace(/[^0-9]/g, '');

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', cleanPhone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return !data || data.length === 0;
}

async function notifyMaddy(reason, details) {
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, details]);
}

module.exports = {
  sendTemplate,
  sendFreeform,
  canSendMessage,
  notifyMaddy,
  detectMarket,
  maskPhone,
  MADDY_PHONE,
};

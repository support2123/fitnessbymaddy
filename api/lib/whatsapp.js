const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '917082478374';

function detectMarket(phone) {
  if (phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('44')) return 'UK';
  if (phone.startsWith('91')) return 'IN';
  return 'GLOBAL';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

async function sendTemplate(phone, templateName, params = []) {
  const recent = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();

  if (recent.data) {
    const lastSent = new Date(recent.data.sent_at);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const isClient = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (lastSent > twoHoursAgo && !isClient.data) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { rateLimited: true };
    }
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation'
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: params.join(' | ') || templateName,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return result;
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

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    template_name: null,
    status: res.ok ? 'sent' : 'failed'
  });

  return res.json();
}

async function notifyMaddy(subject, details) {
  await sendText(MADDY_PHONE, `🚨 ESCALATION: ${subject}\n\n${details}`);
}

module.exports = { sendTemplate, sendText, notifyMaddy, detectMarket, maskPhone };

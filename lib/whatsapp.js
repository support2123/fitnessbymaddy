const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

async function sendTemplate(phone, templateName, params = []) {
  const db = getSupabase();

  const { data: recent } = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (recent && recent.length > 0) {
    const lastSent = new Date(recent[0].sent_at);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const { data: lead } = await db
      .from('leads')
      .select('status')
      .eq('phone', phone)
      .single();

    const isClient = !lead || lead.status === 'converted';
    if (!isClient && lastSent > twoHoursAgo) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { rateLimited: true };
    }
  }

  const apiKey = process.env.AISENSY_API_KEY;
  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: templateName,
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      templateParams: params,
    }),
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: `Template: ${templateName} | Params: ${JSON.stringify(params)}`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  return result;
}

async function sendTextMessage(phone, text) {
  const db = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;

  const res = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: 'text_message',
      destination: phone.replace('+', ''),
      userName: 'FitnessByMaddy',
      message: { text },
    }),
  });

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    template_name: null,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed',
  });

  return res.json();
}

module.exports = { sendTemplate, sendTextMessage, maskPhone, detectMarket };

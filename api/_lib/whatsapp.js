const supabase = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendToLead(phone) {
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

async function isOptedInClient(phone) {
  const { data } = await supabase
    .from('clients')
    .select('id, status')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  return data && data.length > 0;
}

async function sendTemplate(phone, templateName, params = {}) {
  const isClient = await isOptedInClient(phone);
  if (!isClient) {
    const allowed = await canSendToLead(phone);
    if (!allowed) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { success: false, reason: 'rate_limited' };
    }
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/[^0-9]/g, ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    media: params.media || {},
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await res.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: `Template: ${templateName}`,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed',
    });

    return { success: res.ok, data: result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

async function sendText(phone, text) {
  const isClient = await isOptedInClient(phone);
  if (!isClient) {
    const allowed = await canSendToLead(phone);
    if (!allowed) return { success: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'session_message',
    destination: phone.replace(/[^0-9]/g, ''),
    message: text,
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: text,
      status: res.ok ? 'sent' : 'failed',
    });

    return { success: res.ok };
  } catch (err) {
    console.error(`WhatsApp text failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  await sendText(maddyPhone, `ESCALATION: ${subject}\n\n${details}`);
}

module.exports = { sendTemplate, sendText, notifyMaddy, canSendToLead };

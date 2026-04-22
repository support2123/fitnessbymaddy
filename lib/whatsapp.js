const { supabase } = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendMessage(phone, isClient) {
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

async function sendWhatsApp({ phone, message, templateName, templateParams }) {
  const payload = templateName
    ? {
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: templateName,
        destination: phone,
        userName: 'FitnessByMaddy',
        templateParams: templateParams || []
      }
    : {
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: 'direct_message',
        destination: phone,
        userName: 'FitnessByMaddy',
        message: { text: message }
      };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: message || `Template: ${templateName}`,
      template_name: templateName || null,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok, result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: message || `Template: ${templateName}`,
      template_name: templateName || null,
      status: 'error'
    });
    return { ok: false, error: err.message };
  }
}

async function sendEscalation(reason, phone, messageBody) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  await sendWhatsApp({
    phone: maddyPhone,
    message: `\u{1F6A8} ESCALATION\nFrom: ${maskPhone(phone)}\nReason: ${reason}\nMessage: "${messageBody}"\n\nPlease review and respond manually.`
  });
}

module.exports = { canSendMessage, sendWhatsApp, sendEscalation };

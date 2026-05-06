const supabase = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
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

async function sendTemplate(phone, templateName, params = []) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('[WhatsApp] AISENSY_API_KEY not configured');
    return { ok: false, error: 'api_key_missing' };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await res.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: `[template:${templateName}] ${params.join(', ')}`,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    if (!res.ok) {
      console.error(`[WhatsApp] Send failed to ${maskPhone(phone)}:`, result);
    }
    return { ok: res.ok, result };
  } catch (err) {
    console.error(`[WhatsApp] Error sending to ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendText(phone, text) {
  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: 'sent'
  });

  return sendTemplate(phone, 'text_message', [text]);
}

async function logIncoming(phone, body) {
  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body,
    status: 'received'
  });
}

module.exports = { sendTemplate, sendText, logIncoming, canSendToLead };

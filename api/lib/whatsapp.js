const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

async function canSendMessage(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .order('sent_at', { ascending: false })
    .limit(1);

  const isClient = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  if (isClient.data && isClient.data.length > 0) return true;
  return !data || data.length === 0;
}

async function sendTemplate(phone, templateName, params = {}) {
  const allowed = await canSendMessage(phone);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { success: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    source: 'fitnessbymaddy-automation',
    media: params.media || {},
    buttons: params.buttons || [],
    carouselCards: [],
    location: {},
    paramsFallbackValue: {}
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const result = await res.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: `[Template: ${templateName}]`,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { success: res.ok, data: result };
  } catch (err) {
    console.error(`WhatsApp send error for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

async function sendTextMessage(phone, text) {
  const allowed = await canSendMessage(phone);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { success: false, reason: 'rate_limited' };
  }

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: 'text_message',
        destination: phone,
        userName: 'FitnessByMaddy',
        templateParams: [text],
        source: 'fitnessbymaddy-automation'
      })
    });

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: text,
      status: res.ok ? 'sent' : 'failed'
    });

    return { success: res.ok };
  } catch (err) {
    console.error(`WhatsApp text error for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

module.exports = { sendTemplate, sendTextMessage, canSendMessage, maskPhone };

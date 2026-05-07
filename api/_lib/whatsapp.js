const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

async function canSendMessage(phone, isClient) {
  if (isClient) return true;
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);
  return !data || data.length === 0;
}

async function sendTemplate(phone, templateName, params, mediaUrl) {
  const allowed = await canSendMessage(phone, false);
  if (!allowed) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { success: false, reason: 'rate_limited' };
  }
  return sendMessage(phone, templateName, params, mediaUrl);
}

async function sendMessage(phone, templateName, params, mediaUrl) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    source: 'fitnessbymaddy-automation'
  };
  if (mediaUrl) {
    body.media = { url: mediaUrl, filename: 'program.pdf' };
  }

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
      body: templateName,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { success: res.ok, data: result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

async function sendSessionMessage(phone, text) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'session_message',
    destination: phone,
    userName: 'there',
    templateParams: [text],
    source: 'fitnessbymaddy-automation'
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: text,
      template_name: 'session_message',
      status: res.ok ? 'sent' : 'failed'
    });

    return { success: res.ok };
  } catch (err) {
    console.error(`Session msg failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

module.exports = { sendTemplate, sendMessage, sendSessionMessage, canSendMessage, maskPhone };

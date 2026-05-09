const { getSupabase } = require('./supabase');

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

async function canSendMessage(phone, isClient) {
  if (isClient) return true;
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);
  return !data || data.length === 0;
}

async function sendWhatsApp(phone, templateName, params, isClient) {
  if (!await canSendMessage(phone, isClient)) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { success: false, reason: 'rate_limited' };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'automation',
    buttons: []
  };

  try {
    const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await res.json();

    const db = getSupabase();
    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: `[template:${templateName}] ${(params || []).join(', ')}`,
      template_name: templateName,
      sent_at: new Date().toISOString(),
      status: res.ok ? 'sent' : 'failed'
    });

    return { success: res.ok, data: result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

async function sendTextMessage(phone, text, isClient) {
  if (!await canSendMessage(phone, isClient)) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { success: false, reason: 'rate_limited' };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  try {
    const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        campaignName: 'text_message',
        destination: phone,
        userName: 'FitnessByMaddy',
        message: { text },
        source: 'automation'
      })
    });

    const db = getSupabase();
    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: text,
      template_name: null,
      sent_at: new Date().toISOString(),
      status: res.ok ? 'sent' : 'failed'
    });

    return { success: res.ok };
  } catch (err) {
    console.error(`Text send failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

module.exports = { sendWhatsApp, sendTextMessage, maskPhone, canSendMessage };

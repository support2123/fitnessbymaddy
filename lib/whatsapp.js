const { getClient } = require('./supabase');
const { maskPhone } = require('./market');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendWhatsApp(phone, body, templateName, isOptedInClient) {
  const db = getClient();

  if (!isOptedInClient) {
    const twoHoursAgo = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
    const { data: recent } = await db
      .from('messages')
      .select('id')
      .eq('phone', phone)
      .eq('direction', 'out')
      .gte('sent_at', twoHoursAgo)
      .limit(1);

    if (recent && recent.length > 0) {
      console.log(`Rate limited: skipping send to ${maskPhone(phone)}`);
      return { sent: false, reason: 'rate_limited' };
    }
  }

  const apiKey = process.env.AISENSY_API_KEY;
  let result;

  try {
    const payload = {
      apiKey,
      campaignName: templateName || 'direct_message',
      destination: phone.replace(/^\+/, ''),
      userName: 'FitnessByMaddy',
      message: body
    };

    if (templateName) {
      payload.templateParams = [];
      payload.source = 'automation';
      payload.media = {};
      payload.buttons = [];
      payload.carouselCards = [];
      payload.location = {};
    }

    const resp = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    result = await resp.json();
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { sent: false, reason: 'api_error' };
  }

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body,
    template_name: templateName || null,
    sent_at: new Date().toISOString(),
    status: result.success !== false ? 'sent' : 'failed'
  });

  return { sent: true, result };
}

async function logInbound(phone, body) {
  const db = getClient();
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body,
    sent_at: new Date().toISOString(),
    status: 'received'
  });
}

module.exports = { sendWhatsApp, logInbound };

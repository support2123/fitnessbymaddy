const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, body, templateName) {
  const db = getSupabase();

  if (!templateName) {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await db
      .from('messages')
      .select('id')
      .eq('phone', phone)
      .eq('direction', 'out')
      .gte('sent_at', twoHoursAgo)
      .limit(1);

    if (recent && recent.length > 0) {
      return { rateLimited: true };
    }
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName || 'manual_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: [],
    media: {},
  };

  if (templateName) {
    payload.campaignName = templateName;
  } else {
    payload.message = body;
  }

  const resp = await fetch(`${AISENSY_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await resp.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || `[template: ${templateName}]`,
    template_name: templateName || null,
    status: resp.ok ? 'sent' : 'failed',
  });

  return { ok: resp.ok, result };
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

module.exports = { sendWhatsApp, maskPhone, detectMarket };

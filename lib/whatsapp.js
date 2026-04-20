const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith('91') || phone.startsWith('+91')) return 'IN';
  if (phone.startsWith('971') || phone.startsWith('+971')) return 'UAE';
  if (phone.startsWith('44') || phone.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}

function normalizePhone(phone) {
  return phone.replace(/[^0-9]/g, '');
}

async function sendWhatsApp({ phone, templateName, body, params }) {
  const db = getSupabase();
  const normalized = normalizePhone(phone);

  const recent = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', normalized)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (recent.data && recent.data.length > 0) {
    const lastSent = new Date(recent.data[0].sent_at);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    if (lastSent > twoHoursAgo && !templateName?.startsWith('onboard_')) {
      return { throttled: true, message: 'Rate limited: 1 msg per 2 hrs' };
    }
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName || 'direct_message',
    destination: normalized,
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    media: {}
  };

  if (body && !templateName) {
    payload.message = body;
  }

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone: normalized,
    direction: 'out',
    body: body || `template:${templateName}`,
    template_name: templateName || null,
    status: res.ok ? 'sent' : 'failed'
  });

  return { sent: res.ok, result };
}

async function notifyMaddy(reason, details) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  await sendWhatsApp({
    phone: maddyPhone,
    templateName: 'escalation_alert',
    params: [reason, details]
  });
}

module.exports = { sendWhatsApp, notifyMaddy, maskPhone, detectMarket, normalizePhone };

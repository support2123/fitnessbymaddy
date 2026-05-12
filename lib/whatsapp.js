const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendWhatsApp({ phone, templateName, body, params, isClient }) {
  const db = getSupabase();

  if (!isClient) {
    const twoHoursAgo = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
    const { data: recent } = await db
      .from('messages')
      .select('id')
      .eq('phone', phone)
      .eq('direction', 'out')
      .gte('sent_at', twoHoursAgo)
      .limit(1);

    if (recent && recent.length > 0) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { sent: false, reason: 'rate_limited' };
    }
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName || 'direct_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  if (body && !templateName) {
    payload.message = body;
  }

  let result;
  try {
    const resp = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    result = await resp.json();
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { sent: false, reason: 'api_error', error: err.message };
  }

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: body || `[template:${templateName}]`,
    template_name: templateName || null,
    status: result.success !== false ? 'sent' : 'failed'
  });

  return { sent: true, result };
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  const body = `🚨 ${subject}\n\n${details}`;

  await sendWhatsApp({
    phone: maddyPhone,
    body,
    isClient: true
  });

  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'FitnessByMaddy Alerts <support@fitnessbymaddy.com>',
        to: process.env.MADDY_EMAIL || 'maddy@fitnessbymaddy.com',
        subject: `[Alert] ${subject}`,
        text: details
      });
    } catch (err) {
      console.error('Email alert failed:', err.message);
    }
  }
}

module.exports = { sendWhatsApp, notifyMaddy };

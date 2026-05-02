const { getSupabase } = require('./supabase');
const { maskPhone } = require('./utils');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, campaignName, templateParams = []) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { ok: false, error: 'API key missing' };
  }

  const rateLimited = await isRateLimited(phone);
  if (rateLimited) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, error: 'rate_limited' };
  }

  const body = {
    apiKey,
    campaignName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams
  };

  try {
    const resp = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();

    await logMessage(phone, 'out', `[template:${campaignName}] ${templateParams.join(', ')}`, campaignName);

    return { ok: resp.ok, data };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendTextMessage(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('AISENSY_API_KEY not configured');
    return { ok: false, error: 'API key missing' };
  }

  const body = {
    apiKey,
    campaignName: 'session_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    message: text
  };

  try {
    const resp = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();

    await logMessage(phone, 'out', text, null);

    return { ok: resp.ok, data };
  } catch (err) {
    console.error(`WhatsApp text send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function isRateLimited(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  if (client) return false;

  const { count } = await db
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return (count || 0) >= 1;
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
    sent_at: new Date().toISOString()
  });
}

async function notifyMaddy(subject, details) {
  const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';
  const msg = `*ESCALATION*\n${subject}\n\n${details}`;

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [subject, details]);

  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'FitnessByMaddy Alerts <support@fitnessbymaddy.com>',
        to: process.env.MADDY_EMAIL || 'maddy@fitnessbymaddy.com',
        subject: `[ESCALATION] ${subject}`,
        text: details
      });
    } catch (e) {
      console.error('Email notification failed:', e.message);
    }
  }
}

module.exports = {
  sendTemplate,
  sendTextMessage,
  isRateLimited,
  logMessage,
  notifyMaddy
};

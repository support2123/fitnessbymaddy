const { getSupabase } = require('./supabase');
const { maskPhone } = require('./utils');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, bodyParams = [], mediaUrl = null) {
  const db = getSupabase();

  const rateLimited = await checkRateLimit(db, phone);
  if (rateLimited) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: bodyParams,
  };

  if (mediaUrl) {
    payload.mediaUrl = mediaUrl;
    payload.mediaFilename = 'program.pdf';
  }

  try {
    const resp = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: bodyParams.join(' | '),
      template_name: templateName,
      status: resp.ok ? 'sent' : 'failed',
    });

    return { ok: resp.ok, data };
  } catch (err) {
    console.error(`WhatsApp send error for ${maskPhone(phone)}:`, err.message);

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: bodyParams.join(' | '),
      template_name: templateName,
      status: 'error',
    });

    return { ok: false, reason: err.message };
  }
}

async function sendFreeformWhatsApp(phone, message) {
  const db = getSupabase();

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    message,
  };

  try {
    const resp = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: message,
      template_name: 'freeform',
      status: resp.ok ? 'sent' : 'failed',
    });

    return { ok: resp.ok };
  } catch (err) {
    console.error(`Freeform send error for ${maskPhone(phone)}:`, err.message);
    return { ok: false };
  }
}

async function checkRateLimit(db, phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: client } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();

  if (client) return false;

  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return (count || 0) >= 1;
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE;
  if (!maddyPhone) return;

  await sendWhatsApp(maddyPhone, 'escalation_alert', [subject, details]);

  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'FitnessByMaddy Alerts <support@fitnessbymaddy.com>',
        to: 'maddy@fitnessbymaddy.com',
        subject: `[ESCALATION] ${subject}`,
        text: details,
      });
    } catch (err) {
      console.error('Email escalation failed:', err.message);
    }
  }
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp, notifyMaddy };

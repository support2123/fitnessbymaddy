const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendTemplate(phone, templateName, params = []) {
  const db = getSupabase();

  const rateLimited = await isRateLimited(phone);
  if (rateLimited) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { sent: false, reason: 'rate_limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation'
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const result = await res.json();

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: params.join(' | ') || templateName,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { sent: res.ok, result };
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    return { sent: false, error: err.message };
  }
}

async function sendText(phone, message) {
  const db = getSupabase();

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message,
    source: 'automation'
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: message,
      status: res.ok ? 'sent' : 'failed'
    });

    return { sent: res.ok };
  } catch (err) {
    console.error(`WhatsApp text failed for ${maskPhone(phone)}:`, err.message);
    return { sent: false, error: err.message };
  }
}

async function sendDocument(phone, documentUrl, caption) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'document_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    media: { url: documentUrl, filename: 'program.pdf' },
    caption,
    source: 'automation'
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { sent: res.ok };
  } catch (err) {
    return { sent: false, error: err.message };
  }
}

async function isRateLimited(phone) {
  const db = getSupabase();
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);

  return data && data.length > 0;
}

async function notifyMaddy(reason, details) {
  const maddyPhone = '+917082478374';
  const message = `ESCALATION: ${reason}\n${details}`;
  await sendText(maddyPhone, message);
}

module.exports = { sendTemplate, sendText, sendDocument, isRateLimited, notifyMaddy };

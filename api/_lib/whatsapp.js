const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, bodyValues, mediaUrl }) {
  const db = getSupabase();

  if (!process.env.AISENSY_API_KEY) {
    console.error('[WA] AISENSY_API_KEY not configured');
    return { ok: false, error: 'API key missing' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: bodyValues || [],
  };

  if (mediaUrl) {
    payload.mediaUrl = mediaUrl;
    payload.mediaFilename = 'program.pdf';
  }

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    await db.from('messages').insert({
      phone: phone,
      direction: 'out',
      body: bodyValues ? bodyValues.join(' | ') : templateName,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed',
    });

    return { ok: res.ok, data };
  } catch (err) {
    console.error('[WA] Send error:', maskPhone(phone), err.message);
    return { ok: false, error: err.message };
  }
}

async function canSendTo(phone) {
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

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

module.exports = { sendWhatsApp, canSendTo, maskPhone };

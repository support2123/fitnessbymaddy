const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp({ phone, templateName, body, params }) {
  const rateOk = await checkRateLimit(phone);
  if (!rateOk) {
    console.log(`Rate limited: ${phone.slice(0, 3)}XXX...${phone.slice(-3)}`);
    return { ok: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    media: {}
  };

  if (body && !templateName) {
    payload.message = body;
  }

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: body || templateName,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok, data };
  } catch (err) {
    console.error('WhatsApp send error:', err.message);
    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: body || templateName,
      template_name: templateName,
      status: 'error'
    });
    return { ok: false, reason: err.message };
  }
}

async function checkRateLimit(phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  if (client) return true;

  return !data || data.length === 0;
}

async function sendWhatsAppPdf({ phone, templateName, pdfUrl, params }) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params || [],
    media: {
      url: pdfUrl,
      filename: 'weekly-program.pdf'
    }
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: `PDF: ${pdfUrl}`,
      template_name: templateName,
      status: res.ok ? 'sent' : 'failed'
    });

    return { ok: res.ok, data };
  } catch (err) {
    console.error('WhatsApp PDF send error:', err.message);
    return { ok: false, reason: err.message };
  }
}

module.exports = { sendWhatsApp, sendWhatsAppPdf, checkRateLimit };

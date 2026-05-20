const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function checkRateLimit(phone, isClient) {
  if (isClient) return true;

  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    const lastSent = new Date(data[0].sent_at).getTime();
    if (Date.now() - lastSent < RATE_LIMIT_MS) return false;
  }
  return true;
}

async function sendWhatsApp(phone, templateName, options = {}) {
  const { text, isClient, mediaUrl, skipRateLimit } = options;

  if (!skipRateLimit) {
    const allowed = await checkRateLimit(phone, isClient);
    if (!allowed) return { sent: false, reason: 'rate_limited' };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('[WA] AISENSY_API_KEY not set');
    return { sent: false, reason: 'no_api_key' };
  }

  const payload = {
    apiKey,
    campaignName: templateName || 'direct_message',
    destination: phone.replace(/\D/g, ''),
    userName: options.name || 'there',
    source: 'fitnessbymaddy-automation'
  };

  if (templateName) {
    payload.templateParams = options.templateParams || [];
    if (mediaUrl) {
      payload.mediaUrl = mediaUrl;
      payload.mediaFilename = options.mediaFilename || 'program.pdf';
    }
  } else if (text) {
    payload.message = text;
  }

  try {
    const resp = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await resp.json();

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: text || `[template: ${templateName}]`,
      template_name: templateName,
      status: resp.ok ? 'sent' : 'failed'
    });

    return { sent: resp.ok, result };
  } catch (err) {
    console.error('[WA] Send error:', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendWhatsApp, checkRateLimit };

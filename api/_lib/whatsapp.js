const { getSupabase } = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';
const BUSINESS_PHONE = '+917082478374';

async function sendTemplate(phone, templateName, params = []) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('[WA] AISENSY_API_KEY not configured');
    return { ok: false, error: 'api_key_missing' };
  }

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
    media: {},
  };

  try {
    const resp = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();

    await logMessage(phone, 'out', `[template:${templateName}] ${params.join(', ')}`, templateName);

    return { ok: resp.ok, data };
  } catch (err) {
    console.error(`[WA] Send failed to ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendText(phone, message) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('[WA] AISENSY_API_KEY not configured');
    return { ok: false, error: 'api_key_missing' };
  }

  const payload = {
    apiKey,
    campaignName: 'text_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    message,
    source: 'automation',
  };

  try {
    const resp = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();

    await logMessage(phone, 'out', message, null);

    return { ok: resp.ok, data };
  } catch (err) {
    console.error(`[WA] Send failed to ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendDocument(phone, documentUrl, caption) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { ok: false, error: 'api_key_missing' };

  const payload = {
    apiKey,
    campaignName: 'document_message',
    destination: phone.replace(/^\+/, ''),
    userName: 'FitnessByMaddy',
    source: 'automation',
    media: {
      url: documentUrl,
      filename: 'weekly_program.pdf',
    },
    templateParams: [caption || 'Your weekly program is ready!'],
  };

  try {
    const resp = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    await logMessage(phone, 'out', `[document] ${caption}`, 'document_message');
    return { ok: resp.ok, data };
  } catch (err) {
    console.error(`[WA] Doc send failed to ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function logMessage(phone, direction, body, templateName) {
  try {
    const supabase = getSupabase();
    await supabase.from('messages').insert({
      phone,
      direction,
      body: body?.slice(0, 4000),
      template_name: templateName,
      sent_at: new Date().toISOString(),
      status: 'sent',
    });
  } catch (err) {
    console.error(`[WA] Log failed for ${maskPhone(phone)}:`, err.message);
  }
}

async function checkRateLimit(phone) {
  const supabase = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return (count || 0) < 1;
}

module.exports = {
  sendTemplate,
  sendText,
  sendDocument,
  logMessage,
  checkRateLimit,
  BUSINESS_PHONE,
};

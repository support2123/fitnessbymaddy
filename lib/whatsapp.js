const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendTemplate(phone, templateName, params) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error(`[WA] No API key configured — skipping send to ${maskPhone(phone)}`);
    return { ok: false, error: 'no_api_key' };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    source: 'fitnessbymaddy-automation',
    media: params.media || {},
    buttons: params.buttons || [],
  };

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    await logMessage(phone, 'out', params.templateParams?.join(' | ') || templateName, templateName);

    return { ok: res.ok, data };
  } catch (err) {
    console.error(`[WA] Send failed to ${maskPhone(phone)}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function sendFreeform(phone, message) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { ok: false, error: 'no_api_key' };

  const body = {
    apiKey,
    campaignName: 'freeform_reply',
    destination: phone.replace(/^\+/, ''),
    message,
    source: 'fitnessbymaddy-automation',
  };

  try {
    const res = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    await logMessage(phone, 'out', message, null);

    return { ok: res.ok, data };
  } catch (err) {
    console.error(`[WA] Freeform failed to ${maskPhone(phone)}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function canSendToLead(phone) {
  const sb = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await sb
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return !data || data.length === 0;
}

async function logMessage(phone, direction, body, templateName) {
  const sb = getSupabase();
  await sb.from('messages').insert({
    phone,
    direction,
    body: body?.slice(0, 2000),
    template_name: templateName,
  });
}

module.exports = { sendTemplate, sendFreeform, canSendToLead, logMessage };

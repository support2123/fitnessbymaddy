const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const META_API = 'https://graph.facebook.com/v19.0';

async function canSendMessage(phone, isClient) {
  if (isClient) return true;
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);
  return !data || data.length === 0;
}

async function sendTemplate(phone, templateName, params = []) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) return await sendViaMeta(phone, templateName, params);
    await logMessage(phone, 'out', `[template:${templateName}] ${params.join(', ')}`, templateName);
    return { success: true, provider: 'aisensy' };
  } catch {
    return await sendViaMeta(phone, templateName, params);
  }
}

async function sendSession(phone, text) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'session_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: { text },
    source: 'automation'
  };

  try {
    await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    await logMessage(phone, 'out', text, null);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function sendViaMeta(phone, templateName, params) {
  const phoneId = process.env.META_PHONE_NUMBER_ID;
  const token = process.env.META_ACCESS_TOKEN;
  if (!phoneId || !token) return { success: false, error: 'Meta API not configured' };

  const body = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en' },
      components: params.length > 0 ? [{
        type: 'body',
        parameters: params.map(p => ({ type: 'text', text: p }))
      }] : []
    }
  };

  try {
    await fetch(`${META_API}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });
    await logMessage(phone, 'out', `[template:${templateName}] ${params.join(', ')}`, templateName);
    return { success: true, provider: 'meta' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

module.exports = { sendTemplate, sendSession, canSendMessage, logMessage };

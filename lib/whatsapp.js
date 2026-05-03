const { supabase } = require('./supabase');

const AISENSY_CAMPAIGN_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const AISENSY_DIRECT_API = 'https://backend.aisensy.com/direct-apis/t1/messages';

function maskPhone(phone) {
  if (!phone || phone.length < 6) return phone;
  return phone.substring(0, 4) + 'XXX...' + phone.substring(phone.length - 3);
}

async function canSendMessage(phone, isClient) {
  if (isClient) return true;
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);
  return (count || 0) === 0;
}

async function logMessage(phone, direction, body, templateName, status) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body: (body || '').substring(0, 1000),
    template_name: templateName || null,
    sent_at: new Date().toISOString(),
    status
  });
}

async function sendTemplate(phone, templateName, params = {}) {
  const allowed = await canSendMessage(phone, params.isClient);
  if (!allowed) return { skipped: true, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    source: 'automation',
    media: params.media || {},
    buttons: params.buttons || [],
    carouselCards: [],
    location: {}
  };

  try {
    const response = await fetch(AISENSY_CAMPAIGN_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AiSensy-Project-API-Pwd': process.env.AISENSY_API_KEY
      },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    await logMessage(phone, 'out', `Template: ${templateName}`, templateName, response.ok ? 'sent' : 'failed');
    return result;
  } catch (err) {
    console.error(`WhatsApp send failed for ${maskPhone(phone)}:`, err.message);
    await logMessage(phone, 'out', `Template: ${templateName}`, templateName, 'error');
    return { error: err.message };
  }
}

async function sendText(phone, text, isClient = false) {
  const allowed = await canSendMessage(phone, isClient);
  if (!allowed) return { skipped: true, reason: 'rate_limited' };

  try {
    const response = await fetch(AISENSY_DIRECT_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AiSensy-Project-API-Pwd': process.env.AISENSY_API_KEY
      },
      body: JSON.stringify({
        apiKey: process.env.AISENSY_API_KEY,
        to: phone.replace('+', ''),
        type: 'text',
        text: { body: text }
      })
    });
    const result = await response.json();
    await logMessage(phone, 'out', text, null, response.ok ? 'sent' : 'failed');
    return result;
  } catch (err) {
    console.error(`WhatsApp text failed for ${maskPhone(phone)}:`, err.message);
    await logMessage(phone, 'out', text, null, 'error');
    return { error: err.message };
  }
}

async function sendDocument(phone, documentUrl, caption, isClient = false) {
  const allowed = await canSendMessage(phone, isClient);
  if (!allowed) return { skipped: true, reason: 'rate_limited' };

  try {
    const response = await fetch(AISENSY_DIRECT_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AiSensy-Project-API-Pwd': process.env.AISENSY_API_KEY
      },
      body: JSON.stringify({
        apiKey: process.env.AISENSY_API_KEY,
        to: phone.replace('+', ''),
        type: 'document',
        document: { link: documentUrl, caption: caption || '' }
      })
    });
    const result = await response.json();
    await logMessage(phone, 'out', `Document: ${caption}`, null, response.ok ? 'sent' : 'failed');
    return result;
  } catch (err) {
    console.error(`WhatsApp doc failed for ${maskPhone(phone)}:`, err.message);
    return { error: err.message };
  }
}

module.exports = { sendTemplate, sendText, sendDocument, logMessage, maskPhone, canSendMessage };

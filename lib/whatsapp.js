const { getSupabase } = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_API_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';
const MADDY_PHONE = '+917082478374';

// Send a WhatsApp template message via AiSensy
async function sendTemplate(phone, templateName, params = []) {
  const rateLimited = await checkRateLimit(phone);
  if (rateLimited) {
    console.log(`Rate limited: ${maskPhone(phone)}, skipping ${templateName}`);
    return { success: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation'
  };

  try {
    const response = await fetch(AISENSY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    await logMessage(phone, 'out', params.join(' | ') || templateName, templateName);
    console.log(`Sent ${templateName} to ${maskPhone(phone)}`);
    return { success: true, result };
  } catch (err) {
    console.error(`Failed to send ${templateName} to ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

// Send a free-form WhatsApp message (only works within 24h window)
async function sendMessage(phone, body) {
  const rateLimited = await checkRateLimit(phone);
  if (rateLimited) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { success: false, reason: 'rate_limited' };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'freeform_reply',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message: { type: 'text', text: body },
    source: 'automation'
  };

  try {
    const response = await fetch(AISENSY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    await logMessage(phone, 'out', body, null);
    return { success: true, result };
  } catch (err) {
    console.error(`Failed to send message to ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

// Send a WhatsApp message with a document (PDF)
async function sendDocument(phone, documentUrl, caption) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'program_delivery',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    media: { url: documentUrl, filename: 'program.pdf' },
    templateParams: [caption || 'Your weekly program is ready!'],
    source: 'automation'
  };

  try {
    const response = await fetch(AISENSY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    await logMessage(phone, 'out', caption || 'Program PDF sent', 'program_delivery');
    return { success: true, result };
  } catch (err) {
    console.error(`Failed to send document to ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

// Notify Maddy about an escalation
async function notifyMaddy(reason, phone, messageBody) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody
  });

  const text = `🚨 ESCALATION\nFrom: ${maskPhone(phone)}\nReason: ${reason}\nMessage: "${(messageBody || '').slice(0, 200)}"`;

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    maskPhone(phone),
    reason,
    (messageBody || '').slice(0, 100)
  ]);

  return { notified: true };
}

// Rate limit check: max 1 outbound per lead per 2 hours
async function checkRateLimit(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  // Clients (opted-in) bypass rate limit
  const { data: clientData } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  if (clientData && clientData.length > 0) return false;

  return data && data.length > 0;
}

// Log message to audit trail
async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction,
    body: (body || '').slice(0, 2000),
    template_name: templateName,
    status: 'sent'
  });
}

module.exports = {
  sendTemplate,
  sendMessage,
  sendDocument,
  notifyMaddy,
  logMessage,
  checkRateLimit
};

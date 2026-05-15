const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function canSendMessage(phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);
  return !data || data.length === 0;
}

async function isOptedInClient(phone) {
  const { data } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);
  return data && data.length > 0;
}

async function sendTemplate(phone, templateName, params = [], skipRateLimit = false) {
  if (!skipRateLimit) {
    const isClient = await isOptedInClient(phone);
    if (!isClient) {
      const canSend = await canSendMessage(phone);
      if (!canSend) {
        console.log(`Rate limited: ${maskPhone(phone)}`);
        return { success: false, reason: 'rate_limited' };
      }
    }
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
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    await logMessage(phone, 'out', params.join(' | ') || templateName, templateName);
    return { success: true, result };
  } catch (err) {
    console.error(`Send failed to ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

async function sendMedia(phone, templateName, mediaUrl, params = []) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    mediaUrl: mediaUrl,
    source: 'automation'
  };

  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    await logMessage(phone, 'out', `[media] ${mediaUrl}`, templateName);
    return { success: true, result };
  } catch (err) {
    console.error(`Media send failed to ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body: (body || '').substring(0, 1000),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

async function notifyMaddy(subject, details) {
  const maddyPhone = '917082478374';
  const body = `ESCALATION: ${subject}\n${details}`;

  await logMessage(maddyPhone, 'out', body, 'escalation_alert');

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'escalation_alert',
    destination: maddyPhone,
    userName: 'FitnessByMaddy',
    templateParams: [subject, details.substring(0, 500)],
    source: 'escalation'
  };

  try {
    await fetch(AISENSY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error('Escalation notify failed:', err.message);
  }
}

module.exports = {
  sendTemplate,
  sendMedia,
  logMessage,
  notifyMaddy,
  canSendMessage,
  isOptedInClient
};

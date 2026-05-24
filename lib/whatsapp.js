const { supabase } = require('./supabase');

const AISENSY_ENDPOINT = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000;

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^+\d]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

async function canSend(phone) {
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .single();

  if (client) return true;

  const { data: recent } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);

  if (recent && recent.length > 0) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return false;
  }

  return true;
}

async function logMessage(phone, direction, body, templateName) {
  const { error } = await supabase.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName || null,
    sent_at: new Date().toISOString()
  });

  if (error) {
    console.error(`Failed to log message for ${maskPhone(phone)}:`, error.message);
  }
}

async function sendTemplate(phone, templateName, params) {
  const allowed = await canSend(phone);
  if (!allowed) return { success: false, reason: 'rate_limited' };

  const res = await fetch(AISENSY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params
    })
  });

  const result = await res.json();

  if (!res.ok) {
    console.error(`Template send failed for ${maskPhone(phone)}:`, result);
    return { success: false, reason: 'api_error', detail: result };
  }

  await logMessage(phone, 'out', JSON.stringify(params), templateName);
  console.log(`Template "${templateName}" sent to ${maskPhone(phone)}`);
  return { success: true, result };
}

async function sendText(phone, message) {
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .single();

  if (!client) {
    console.log(`Text blocked for non-client ${maskPhone(phone)}`);
    return { success: false, reason: 'not_opted_in' };
  }

  const res = await fetch(AISENSY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: 'text_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message
    })
  });

  const result = await res.json();

  if (!res.ok) {
    console.error(`Text send failed for ${maskPhone(phone)}:`, result);
    return { success: false, reason: 'api_error', detail: result };
  }

  await logMessage(phone, 'out', message, null);
  console.log(`Text sent to ${maskPhone(phone)}`);
  return { success: true, result };
}

module.exports = {
  sendTemplate,
  sendText,
  canSend,
  logMessage,
  maskPhone,
  detectMarket
};

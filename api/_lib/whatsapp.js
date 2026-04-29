const { supabase } = require('./supabase');

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

function maskPhone(phone) {
  const cleaned = phone.replace(/\s+/g, '');
  if (cleaned.length <= 6) return '***';
  return cleaned.slice(0, 4) + 'XXX...' + cleaned.slice(-3);
}

async function isRateLimited(phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  // Clients (opted-in) bypass rate limiting
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .single();

  if (client) return false;

  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('created_at', twoHoursAgo);

  return count >= 1;
}

async function logMessage(phone, direction, body, templateName) {
  const { error } = await supabase.from('messages').insert({
    phone,
    direction,
    body,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
  if (error) {
    console.error(`Failed to log message for ${maskPhone(phone)}:`, error.message);
  }
}

async function sendTemplate(phone, templateName, params = {}) {
  const limited = await isRateLimited(phone);
  if (limited) {
    console.log(`Rate limited: skipping template to ${maskPhone(phone)}`);
    return { success: false, reason: 'rate_limited' };
  }

  try {
    const response = await fetch(AISENSY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: templateName,
        destination: phone,
        userName: templateName,
        templateParams: Array.isArray(params) ? params : Object.values(params),
      }),
    });

    const data = await response.json();

    await logMessage(phone, 'out', JSON.stringify(params), templateName);

    return { success: true, data };
  } catch (err) {
    console.error(`Template send failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

async function sendText(phone, message) {
  const limited = await isRateLimited(phone);
  if (limited) {
    console.log(`Rate limited: skipping text to ${maskPhone(phone)}`);
    return { success: false, reason: 'rate_limited' };
  }

  try {
    const response = await fetch(AISENSY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: 'text_message',
        destination: phone,
        userName: 'FitnessByMaddy',
        message,
      }),
    });

    const data = await response.json();

    await logMessage(phone, 'out', message, null);

    return { success: true, data };
  } catch (err) {
    console.error(`Text send failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, reason: err.message };
  }
}

module.exports = { sendTemplate, sendText, maskPhone };

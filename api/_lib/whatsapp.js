const { supabase } = require('./supabase');

const AISENSY_BASE_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

/**
 * Mask a phone number for logging purposes.
 * e.g., +919876543210 -> +91XXX...210
 * @param {string} phone
 * @returns {string}
 */
function maskPhone(phone) {
  if (!phone || phone.length < 6) return phone || '';
  const prefix = phone.slice(0, 3);
  const suffix = phone.slice(-3);
  return `${prefix}XXX...${suffix}`;
}

/**
 * Check rate limiting for non-client contacts.
 * Enforces a 2-hour gap between outbound messages.
 * @param {string} phone
 * @returns {Promise<boolean>} true if rate-limited (should NOT send)
 */
async function isRateLimited(phone) {
  // Check if phone belongs to an active client
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .single();

  // No rate limit for active clients
  if (client) return false;

  // Check last outbound message to this phone
  const { data: lastMessage } = await supabase
    .from('messages')
    .select('created_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!lastMessage) return false;

  const lastSentAt = new Date(lastMessage.created_at).getTime();
  const now = Date.now();

  return (now - lastSentAt) < RATE_LIMIT_MS;
}

/**
 * Log an outbound message to the messages table.
 * @param {string} phone
 * @param {string} content
 * @param {string} type - 'template' or 'text'
 */
async function logMessage(phone, body, templateName) {
  try {
    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body,
      template_name: templateName || null,
      sent_at: new Date().toISOString()
    });
  } catch (err) {
    console.error(`[whatsapp] Failed to log message to ${maskPhone(phone)}:`, err.message);
  }
}

/**
 * Send a template message via AiSensy.
 * @param {string} phone - Recipient phone number with country code
 * @param {string} templateName - AiSensy template name
 * @param {object} params - Template parameters
 * @returns {Promise<object>} API response
 */
async function sendTemplate(phone, templateName, params = {}) {
  const rateLimited = await isRateLimited(phone);
  if (rateLimited) {
    console.log(`[whatsapp] Rate-limited: skipping template to ${maskPhone(phone)}`);
    return { success: false, reason: 'rate_limited' };
  }

  try {
    const response = await fetch(`${AISENSY_BASE_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: templateName,
        destination: phone,
        userName: phone,
        templateParams: Array.isArray(params) ? params : Object.values(params),
        ...(params.media ? { media: params.media } : {})
      })
    });

    const data = await response.json();
    console.log(`[whatsapp] Template "${templateName}" sent to ${maskPhone(phone)}`);

    await logMessage(phone, JSON.stringify(params), templateName);

    return { success: true, data };
  } catch (err) {
    console.error(`[whatsapp] Failed to send template to ${maskPhone(phone)}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send a plain text message via AiSensy.
 * @param {string} phone - Recipient phone number with country code
 * @param {string} message - Text message content
 * @returns {Promise<object>} API response
 */
async function sendText(phone, message) {
  const rateLimited = await isRateLimited(phone);
  if (rateLimited) {
    console.log(`[whatsapp] Rate-limited: skipping text to ${maskPhone(phone)}`);
    return { success: false, reason: 'rate_limited' };
  }

  try {
    const response = await fetch(`${AISENSY_BASE_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: 'text_message',
        destination: phone,
        userName: phone,
        message
      })
    });

    const data = await response.json();
    console.log(`[whatsapp] Text sent to ${maskPhone(phone)}: ${message.slice(0, 50)}...`);

    await logMessage(phone, message, null);

    return { success: true, data };
  } catch (err) {
    console.error(`[whatsapp] Failed to send text to ${maskPhone(phone)}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendTemplate, sendText, maskPhone };

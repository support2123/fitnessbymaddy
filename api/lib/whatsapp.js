const { getSupabase } = require('./supabase');
const { maskPhone } = require('./helpers');

const AISENSY_API_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MINUTES = 120; // 2 hours

/**
 * Check whether we can send an outbound message to this phone number.
 * Clients are exempt from rate limiting.
 * Non-clients: max 1 outbound message per 2 hours.
 *
 * @param {string} phone
 * @returns {Promise<boolean>} true if sending is allowed
 */
async function canSend(phone) {
  const supabase = getSupabase();

  // Check if this phone belongs to a paying client (clients skip rate limits)
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (client) {
    return true;
  }

  // Check the last outbound message timestamp
  const cutoff = new Date(Date.now() - RATE_LIMIT_MINUTES * 60 * 1000).toISOString();

  const { data: recent } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .limit(1);

  return !recent || recent.length === 0;
}

/**
 * Log a message to the messages table.
 *
 * @param {object} opts
 * @param {string} opts.phone
 * @param {'inbound'|'outbound'} opts.direction
 * @param {string} opts.body
 * @param {string} [opts.template_name]
 * @param {'sent'|'failed'|'rate_limited'} [opts.status='sent']
 */
async function logMessage({ phone, direction, body, template_name, status = 'sent' }) {
  const supabase = getSupabase();

  const dir = direction === 'inbound' ? 'in' : direction === 'outbound' ? 'out' : direction;
  const { error } = await supabase.from('messages').insert({
    phone,
    direction: dir,
    body,
    template_name: template_name || null,
    status,
    sent_at: new Date().toISOString(),
  });

  if (error) {
    console.error(`[whatsapp] Failed to log message for ${maskPhone(phone)}:`, error.message);
  }
}

/**
 * Send a templated WhatsApp message via AiSensy.
 *
 * @param {string} phone - E.164 phone number
 * @param {string} templateName - AiSensy campaign/template name
 * @param {object} [params={}] - Template variable substitutions
 * @returns {Promise<{success: boolean, rateLimited?: boolean, error?: string}>}
 */
async function sendWhatsApp(phone, templateName, params = {}) {
  // Rate-limit check
  const allowed = await canSend(phone);
  if (!allowed) {
    console.log(`[whatsapp] Rate limited: skipping send to ${maskPhone(phone)}`);
    await logMessage({
      phone,
      direction: 'outbound',
      body: `[template: ${templateName}]`,
      template_name: templateName,
      status: 'rate_limited',
    });
    return { success: false, rateLimited: true };
  }

  try {
    const response = await fetch(AISENSY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: templateName,
        destination: phone.replace('+', ''),
        userName: params.name || 'there',
        templateParams: params.templateParams || [],
        source: 'fitnessbymaddy-api',
        ...params,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error(
        `[whatsapp] AiSensy error for ${maskPhone(phone)}: ${response.status}`,
        result.message || ''
      );
      await logMessage({
        phone,
        direction: 'outbound',
        body: `[template: ${templateName}] Error: ${response.status}`,
        template_name: templateName,
        status: 'failed',
      });
      return { success: false, error: result.message || `HTTP ${response.status}` };
    }

    await logMessage({
      phone,
      direction: 'outbound',
      body: `[template: ${templateName}]`,
      template_name: templateName,
      status: 'sent',
    });

    return { success: true };
  } catch (err) {
    console.error(`[whatsapp] Network error sending to ${maskPhone(phone)}:`, err.message);
    await logMessage({
      phone,
      direction: 'outbound',
      body: `[template: ${templateName}] Network error`,
      template_name: templateName,
      status: 'failed',
    });
    return { success: false, error: err.message };
  }
}

/**
 * Send a freeform (session/non-template) WhatsApp message.
 * This is used for messages within a 24-hour session window.
 *
 * @param {string} phone - E.164 phone number
 * @param {string} message - Plain text message body
 * @returns {Promise<{success: boolean, rateLimited?: boolean, error?: string}>}
 */
async function sendFreeformWhatsApp(phone, message) {
  // Rate-limit check
  const allowed = await canSend(phone);
  if (!allowed) {
    console.log(`[whatsapp] Rate limited: skipping freeform to ${maskPhone(phone)}`);
    await logMessage({
      phone,
      direction: 'outbound',
      body: message,
      status: 'rate_limited',
    });
    return { success: false, rateLimited: true };
  }

  try {
    const response = await fetch(AISENSY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: 'freeform_session_message',
        destination: phone.replace('+', ''),
        userName: 'there',
        message,
        source: 'fitnessbymaddy-api',
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error(
        `[whatsapp] Freeform error for ${maskPhone(phone)}: ${response.status}`,
        result.message || ''
      );
      await logMessage({
        phone,
        direction: 'outbound',
        body: message,
        status: 'failed',
      });
      return { success: false, error: result.message || `HTTP ${response.status}` };
    }

    await logMessage({
      phone,
      direction: 'outbound',
      body: message,
      status: 'sent',
    });

    return { success: true };
  } catch (err) {
    console.error(`[whatsapp] Freeform network error for ${maskPhone(phone)}:`, err.message);
    await logMessage({
      phone,
      direction: 'outbound',
      body: message,
      status: 'failed',
    });
    return { success: false, error: err.message };
  }
}

module.exports = { sendWhatsApp, sendFreeformWhatsApp, logMessage };

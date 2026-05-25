const { getSupabase } = require('./supabase');

const AISENSY_API_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_HOURS = 2;

/**
 * Mask a phone number for logging — shows only the last 3 digits.
 * "+917082478374" → "***374"
 */
function maskPhone(phone) {
  if (!phone || phone.length < 3) return '***';
  return '***' + phone.slice(-3);
}

/**
 * Check whether we should rate-limit messages to this phone number.
 * Non-clients are limited to one message every 2 hours.
 * Returns true if the message should be blocked.
 */
async function isRateLimited(supabase, phone) {
  // Check if the phone belongs to an active client (clients are exempt)
  const { data: lead } = await supabase
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .single();

  if (lead && lead.status === 'client') {
    return false;
  }

  // For non-clients, check last outbound message time
  const cutoff = new Date(Date.now() - RATE_LIMIT_HOURS * 60 * 60 * 1000).toISOString();

  const { data: recent } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff)
    .order('sent_at', { ascending: false })
    .limit(1);

  return recent && recent.length > 0;
}

/**
 * Log an outbound message to the messages table.
 */
async function logMessage(supabase, { phone, body, templateName, status }) {
  const { error } = await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: body || templateName,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status,
  });

  if (error) {
    console.error(`[whatsapp] Failed to log message for ${maskPhone(phone)}:`, error.message);
  }
}

/**
 * Send a WhatsApp message via AiSensy API.
 *
 * @param {string} phone - Full international phone number (e.g. "+917082478374")
 * @param {string} templateName - AiSensy campaign/template name
 * @param {object} params - Template parameters (varies by template)
 * @returns {{ success: boolean, error?: string }}
 */
async function sendWhatsApp(phone, templateName, params = {}) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('[whatsapp] AISENSY_API_KEY not set');
    return { success: false, error: 'API key not configured' };
  }

  const supabase = getSupabase();

  // Rate-limit check
  try {
    const limited = await isRateLimited(supabase, phone);
    if (limited) {
      console.log(`[whatsapp] Rate-limited: skipping message to ${maskPhone(phone)}`);
      return { success: false, error: 'rate_limited' };
    }
  } catch (err) {
    // If rate-limit check fails, log but proceed (fail open for important messages)
    console.error(`[whatsapp] Rate-limit check failed for ${maskPhone(phone)}:`, err.message);
  }

  // Send via AiSensy
  try {
    const response = await fetch(AISENSY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKey,
        campaignName: templateName,
        destination: phone.replace('+', ''),
        userName: params.name || 'there',
        templateParams: params.templateParams || [],
        source: 'fitness-by-maddy-automation',
        media: params.media || {},
        buttons: params.buttons || [],
        carouselCards: params.carouselCards || [],
        location: params.location || {},
        paramsFallbackValue: params.paramsFallbackValue || {},
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error(
        `[whatsapp] AiSensy error for ${maskPhone(phone)}:`,
        result.message || response.statusText
      );
      await logMessage(supabase, {
        phone,
        body: JSON.stringify(params),
        templateName,
        status: 'failed',
      });
      return { success: false, error: result.message || 'API request failed' };
    }

    await logMessage(supabase, {
      phone,
      body: JSON.stringify(params),
      templateName,
      status: 'sent',
    });

    console.log(`[whatsapp] Sent "${templateName}" to ${maskPhone(phone)}`);
    return { success: true };
  } catch (err) {
    console.error(`[whatsapp] Network error for ${maskPhone(phone)}:`, err.message);
    await logMessage(supabase, {
      phone,
      body: JSON.stringify(params),
      templateName,
      status: 'error',
    });
    return { success: false, error: err.message };
  }
}

module.exports = { sendWhatsApp, maskPhone };

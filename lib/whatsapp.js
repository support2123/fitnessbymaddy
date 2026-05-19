import { createClient } from './supabase.js';
import { maskPhone } from './helpers.js';

const AISENSY_CAMPAIGN_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

/**
 * Check rate limit: max 1 outbound message per lead per 2 hours.
 * Skips check for leads with status 'active'.
 * Returns true if sending is allowed.
 */
async function checkRateLimit(phone) {
  if (!phone) return false;

  const supabase = createClient();

  // Check if lead is an active client (exempt from rate limit)
  const { data: lead } = await supabase
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .maybeSingle();

  if (lead?.status === 'active') return true;

  // Check for recent outbound message within last 2 hours
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: recent } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  if (recent && recent.length > 0) {
    console.log(`Rate limited: skipping send to ${maskPhone(phone)}`);
    return false;
  }

  return true;
}

/**
 * Log an outbound message to the messages table.
 */
async function logMessage({ phone, direction, template_name, body, status }) {
  try {
    const supabase = createClient();
    await supabase.from('messages').insert({
      phone,
      direction: direction || 'out',
      template_name: template_name || null,
      body: body || null,
      status: status || 'sent',
    });
  } catch (err) {
    console.error(`Failed to log message for ${maskPhone(phone)}:`, err.message);
  }
}

/**
 * Send a WhatsApp template message via AiSensy.
 */
export async function sendTemplate(phone, templateName, params) {
  if (!phone || !templateName) {
    console.error('sendTemplate: missing phone or templateName');
    return null;
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('sendTemplate: missing AISENSY_API_KEY');
    return null;
  }

  // Rate limit check
  const allowed = await checkRateLimit(phone);
  if (!allowed) return null;

  try {
    const res = await fetch(AISENSY_CAMPAIGN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        apiKey,
        campaignName: templateName,
        destination: phone,
        userName: 'FitnessByMaddy',
        templateParams: params || [],
      }),
    });

    const data = await res.json();

    await logMessage({
      phone,
      direction: 'out',
      template_name: templateName,
      body: JSON.stringify(params || []),
      status: res.ok ? 'sent' : 'failed',
    });

    return data;
  } catch (err) {
    console.error(
      `sendTemplate failed for ${maskPhone(phone)}:`,
      err.message
    );

    await logMessage({
      phone,
      direction: 'out',
      template_name: templateName,
      body: JSON.stringify(params || []),
      status: 'error',
    });

    return null;
  }
}

/**
 * Send a free-form WhatsApp text message via AiSensy session messaging.
 */
export async function sendText(phone, message) {
  if (!phone || !message) {
    console.error('sendText: missing phone or message');
    return null;
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('sendText: missing AISENSY_API_KEY');
    return null;
  }

  // Rate limit check
  const allowed = await checkRateLimit(phone);
  if (!allowed) return null;

  try {
    const res = await fetch(AISENSY_CAMPAIGN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        apiKey,
        campaignName: 'session_message',
        destination: phone,
        userName: 'FitnessByMaddy',
        message,
      }),
    });

    const data = await res.json();

    await logMessage({
      phone,
      direction: 'out',
      template_name: null,
      body: message,
      status: res.ok ? 'sent' : 'failed',
    });

    return data;
  } catch (err) {
    console.error(
      `sendText failed for ${maskPhone(phone)}:`,
      err.message
    );

    await logMessage({
      phone,
      direction: 'out',
      template_name: null,
      body: message,
      status: 'error',
    });

    return null;
  }
}

// api/_lib/whatsapp.js — AiSensy WhatsApp integration for FitnessByMaddy

const { supabase } = require('./supabase');
const { maskPhone } = require('./utils');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

/**
 * Check whether this phone is rate-limited for outbound messages.
 * Max 1 outbound per lead per 2 hours, unless the phone belongs to
 * an active client.
 * Returns true if the message should be BLOCKED.
 */
async function isRateLimited(phone) {
  try {
    // Active clients are exempt from rate limiting
    const { data: activeClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (activeClient) return false;

    // Check for recent outbound messages (last 2 hours)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: recentMessages, error } = await supabase
      .from('messages')
      .select('id')
      .eq('phone', phone)
      .eq('direction', 'out')
      .gte('sent_at', twoHoursAgo)
      .limit(1);

    if (error) {
      console.error(`[whatsapp] rate-limit check failed for ${maskPhone(phone)}:`, error.message);
      return false; // fail open so messages aren't silently dropped
    }

    return recentMessages && recentMessages.length > 0;
  } catch (err) {
    console.error(`[whatsapp] rate-limit error for ${maskPhone(phone)}:`, err.message);
    return false;
  }
}

/**
 * Log an outbound message to the messages table.
 */
async function logMessage(phone, body, templateName) {
  try {
    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: body || null,
      template_name: templateName || null,
      sent_at: new Date().toISOString(),
      status: 'sent',
    });
  } catch (err) {
    console.error(`[whatsapp] failed to log message for ${maskPhone(phone)}:`, err.message);
  }
}

/**
 * Send a WhatsApp template message via AiSensy campaign API.
 *
 * @param {string} phone — Recipient phone in E.164 format
 * @param {string} templateName — AiSensy template name
 * @param {Array} params — Template parameter values
 * @returns {{ success: boolean, data?: object, error?: string }}
 */
async function sendTemplate(phone, templateName, params = []) {
  // Rate-limit check
  if (await isRateLimited(phone)) {
    console.log(`[whatsapp] rate-limited: skipping template "${templateName}" to ${maskPhone(phone)}`);
    return { success: false, error: 'rate_limited' };
  }

  try {
    const response = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AiSensy-Project-API-Pwd': process.env.AISENSY_API_KEY,
      },
      body: JSON.stringify({
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: templateName,
        destination: phone,
        userName: 'FitnessByMaddy',
        templateParams: params,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`[whatsapp] AiSensy error sending template "${templateName}" to ${maskPhone(phone)}:`, data);
      return { success: false, error: data.message || 'aisensy_error' };
    }

    // Log to Supabase
    await logMessage(phone, `[template: ${templateName}] ${params.join(', ')}`, templateName);

    return { success: true, data };
  } catch (err) {
    console.error(`[whatsapp] sendTemplate failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send a free-form text message via AiSensy.
 *
 * @param {string} phone — Recipient phone in E.164 format
 * @param {string} message — Text message body
 * @returns {{ success: boolean, data?: object, error?: string }}
 */
async function sendText(phone, message) {
  // Rate-limit check
  if (await isRateLimited(phone)) {
    console.log(`[whatsapp] rate-limited: skipping text to ${maskPhone(phone)}`);
    return { success: false, error: 'rate_limited' };
  }

  try {
    const response = await fetch(AISENSY_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AiSensy-Project-API-Pwd': process.env.AISENSY_API_KEY,
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

    if (!response.ok) {
      console.error(`[whatsapp] AiSensy error sending text to ${maskPhone(phone)}:`, data);
      return { success: false, error: data.message || 'aisensy_error' };
    }

    // Log to Supabase
    await logMessage(phone, message, null);

    return { success: true, data };
  } catch (err) {
    console.error(`[whatsapp] sendText failed for ${maskPhone(phone)}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendTemplate, sendText };

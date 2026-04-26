// api/_lib/escalation.js — Human escalation detection and notification

const { supabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./utils');

/**
 * Escalation keyword categories.
 */
const ESCALATION_KEYWORDS = {
  medical: [
    'injury', 'medical', 'pregnant', 'pregnancy',
    'medication', 'medicine', 'surgery', 'doctor',
  ],
  distress: [
    'pain', 'dizzy', 'dizziness', 'faint',
    'eating disorder', 'bulimia', 'anorexia', 'vomit',
  ],
  complaint: [
    'refund', 'lawyer', 'complaint', "didn't work",
    'side effect', 'scam',
  ],
};

/**
 * Check whether a message contains escalation keywords.
 *
 * @param {string} messageBody — The inbound message text
 * @returns {{ shouldEscalate: boolean, reason: string }}
 */
function checkEscalation(messageBody) {
  if (!messageBody) return { shouldEscalate: false, reason: '' };

  const msg = messageBody.toLowerCase();

  for (const [category, keywords] of Object.entries(ESCALATION_KEYWORDS)) {
    for (const keyword of keywords) {
      if (msg.includes(keyword)) {
        return {
          shouldEscalate: true,
          reason: `${category}: detected keyword "${keyword}"`,
        };
      }
    }
  }

  return { shouldEscalate: false, reason: '' };
}

/**
 * Notify Maddy about an escalation via WhatsApp and email, and log to DB.
 *
 * @param {string} reason — Why the escalation was triggered
 * @param {{ phone?: string, clientId?: string, messageBody?: string }} details
 */
async function notifyMaddy(reason, details = {}) {
  const maddyPhone = process.env.MADDY_PHONE;
  const maddyEmail = process.env.MADDY_EMAIL;
  const resendApiKey = process.env.RESEND_API_KEY;

  // 1. Insert into escalations table
  try {
    await supabase.from('escalations').insert({
      phone: details.phone || 'unknown',
      client_id: details.clientId || null,
      reason,
      message_body: details.messageBody || null,
      resolved: false,
    });
  } catch (err) {
    console.error('[escalation] failed to insert escalation record:', err.message);
  }

  // 2. Send WhatsApp notification to Maddy
  if (maddyPhone) {
    try {
      await sendTemplate(maddyPhone, 'escalation_alert', [
        reason,
        details.phone ? maskPhone(details.phone) : 'unknown',
        details.messageBody ? details.messageBody.slice(0, 200) : 'N/A',
      ]);
    } catch (err) {
      console.error('[escalation] failed to WhatsApp Maddy:', err.message);
    }
  }

  // 3. Send email via Resend
  if (resendApiKey && maddyEmail) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: 'support@fitnessbymaddy.com',
          to: maddyEmail,
          subject: `[ESCALATION] ${reason}`,
          html: [
            '<h2>Escalation Alert</h2>',
            `<p><strong>Reason:</strong> ${reason}</p>`,
            `<p><strong>Phone:</strong> ${details.phone ? maskPhone(details.phone) : 'unknown'}</p>`,
            `<p><strong>Message:</strong> ${details.messageBody || 'N/A'}</p>`,
            `<p><strong>Time:</strong> ${new Date().toISOString()}</p>`,
          ].join('\n'),
        }),
      });
    } catch (err) {
      console.error('[escalation] failed to email Maddy:', err.message);
    }
  }
}

module.exports = { checkEscalation, notifyMaddy };

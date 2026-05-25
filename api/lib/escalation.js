const { getSupabase } = require('./supabase');
const { sendWhatsApp, logMessage } = require('./whatsapp');
const { maskPhone } = require('./helpers');

const MADDY_PHONE = '+917082478374';

const TRIGGER_WORDS = [
  'refund',
  'lawyer',
  'complaint',
  "didn't work",
  'side effect',
  'injury',
  'medical',
  'pregnant',
  'pregnancy',
  'medication',
  'pain',
  'dizziness',
  'dizzy',
  'eating disorder',
  'not eating',
];

/**
 * Scan an incoming message for escalation trigger keywords.
 * If any are found, logs a notification and alerts Maddy via WhatsApp.
 *
 * @param {string} phone - The sender's phone number (E.164)
 * @param {string} messageBody - The incoming message text
 * @returns {Promise<{escalated: boolean, triggers: string[]}>}
 */
async function checkEscalation(phone, messageBody) {
  if (!messageBody) return { escalated: false, triggers: [] };

  const lower = String(messageBody).toLowerCase();
  const matched = TRIGGER_WORDS.filter((word) => lower.includes(word));

  if (matched.length === 0) {
    return { escalated: false, triggers: [] };
  }

  console.warn(
    `[escalation] Trigger detected from ${maskPhone(phone)}: [${matched.join(', ')}]`
  );

  // Log the escalation notification to the messages table
  const notificationBody = `ESCALATION ALERT: Message from ${maskPhone(phone)} triggered keywords: [${matched.join(', ')}]. Original message: "${messageBody}"`;

  await logMessage({
    phone,
    direction: 'outbound',
    body: notificationBody,
    template_name: 'escalation_alert',
    status: 'sent',
  });

  // Alert Maddy via WhatsApp
  try {
    await sendWhatsApp(MADDY_PHONE, 'escalation_alert', {
      templateParams: [
        maskPhone(phone),
        matched.join(', '),
        messageBody.slice(0, 200),
      ],
    });
  } catch (err) {
    console.error('[escalation] Failed to notify Maddy:', err.message);
  }

  return { escalated: true, triggers: matched };
}

/**
 * Send a programmatic escalation/notification to Maddy.
 * Used for system-level alerts (e.g., payment failures, stuck workflows).
 *
 * @param {string} subject - Short summary of the issue
 * @param {string} details - Full details/context
 * @returns {Promise<void>}
 */
async function notifyMaddy(subject, details) {
  console.warn(`[escalation] Notifying Maddy: ${subject}`);

  const notificationBody = `SYSTEM ALERT: ${subject} — ${details}`;

  // Log to messages table under Maddy's phone
  await logMessage({
    phone: MADDY_PHONE,
    direction: 'outbound',
    body: notificationBody,
    template_name: 'system_alert',
    status: 'sent',
  });

  try {
    await sendWhatsApp(MADDY_PHONE, 'system_alert', {
      templateParams: [subject, details.slice(0, 500)],
    });
  } catch (err) {
    console.error('[escalation] Failed to send system alert to Maddy:', err.message);
  }
}

module.exports = { checkEscalation, notifyMaddy };

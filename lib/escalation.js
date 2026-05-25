const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const TRIGGER_WORDS = [
  'injury',
  'medical',
  'pregnant',
  'pregnancy',
  'medication',
  'pain',
  'dizziness',
  'eating disorder',
  'refund',
  'lawyer',
  'complaint',
  "didn't work",
  'side effect',
];

/**
 * Check whether an incoming message contains escalation trigger words.
 * If triggered, sends an alert to Maddy's WhatsApp with the lead's message and phone.
 *
 * @param {string} message - The incoming message text
 * @param {string} phone - The sender's phone number
 * @returns {boolean} true if escalation was triggered
 */
async function checkEscalation(message, phone) {
  if (!message || !phone) return false;

  const lowerMessage = message.toLowerCase();

  const triggered = TRIGGER_WORDS.some((word) => lowerMessage.includes(word));

  if (!triggered) return false;

  const matchedWords = TRIGGER_WORDS.filter((word) => lowerMessage.includes(word));

  console.log(
    `[escalation] Triggered for ${phone.slice(-3)} — matched: ${matchedWords.join(', ')}`
  );

  // Alert Maddy
  try {
    await sendWhatsApp(MADDY_PHONE, 'escalation_alert', {
      name: 'Maddy',
      templateParams: [
        phone,
        message.slice(0, 500),
        matchedWords.join(', '),
      ],
    });
  } catch (err) {
    console.error('[escalation] Failed to alert Maddy:', err.message);
  }

  return true;
}

module.exports = { checkEscalation, TRIGGER_WORDS };

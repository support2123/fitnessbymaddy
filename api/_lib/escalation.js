const { supabase } = require('./supabase');
const { sendTemplate, maskPhone } = require('./whatsapp');
const { MADDY_PHONE } = require('./constants');

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

async function checkEscalation(message, phone) {
  const lower = message.toLowerCase();
  const matched = TRIGGER_WORDS.find((word) => lower.includes(word));

  if (!matched) {
    return { escalated: false, reason: null };
  }

  const reason = `Trigger word detected: "${matched}"`;

  const { error } = await supabase.from('escalations').insert({
    phone,
    message_body: message,
    reason,
  });

  if (error) {
    console.error(`Failed to insert escalation for ${maskPhone(phone)}:`, error.message);
  }

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    phone,
    matched,
    message.slice(0, 200),
  ]);

  return { escalated: true, reason };
}

module.exports = { checkEscalation };

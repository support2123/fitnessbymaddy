import { sendTemplate } from './whatsapp.js';

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'heart', 'diabetes', 'blood pressure',
  'doctor', 'hospital',
];

export function needsEscalation(message) {
  const msg = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => msg.includes(kw));
}

export async function escalateToMaddy(reason, context) {
  const alertMsg = `ESCALATION ALERT\nReason: ${reason}\nPhone: ${context.phone}\nMessage: ${context.message || 'N/A'}\nClient: ${context.name || 'Unknown'}`;

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    context.phone || 'unknown',
    (context.message || '').slice(0, 200),
  ]);

  return alertMsg;
}

export function isOptOut(message) {
  const msg = (message || '').toLowerCase().trim();
  return msg === 'stop' || msg === 'unsubscribe' || msg === 'opt out' || msg === 'optout';
}

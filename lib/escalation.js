import { sendWhatsApp } from './whatsapp.js';
import { maskPhone } from './market.js';

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'purge', 'not eating'
];

export function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

export async function escalateToMaddy({ reason, phone, message, clientName }) {
  const masked = maskPhone(phone);
  const body = `ESCALATION ALERT\n\nReason: ${reason}\nClient: ${clientName || 'Unknown'}\nPhone: ${masked}\nMessage: "${(message || '').slice(0, 200)}"\n\nPlease review and respond manually.`;

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    body,
    isClient: true
  });
}

export async function escalateMissedCheckins({ clientName, phone, weeksMissed }) {
  const masked = maskPhone(phone);
  const body = `MISSED CHECK-IN ALERT\n\nClient: ${clientName}\nPhone: ${masked}\nConsecutive missed: ${weeksMissed}\n\nPlease follow up.`;

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    body,
    isClient: true
  });
}

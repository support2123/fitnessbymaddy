import { sendWhatsApp } from './whatsapp.js';
import { maskPhone } from './mask.js';

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating',
];

export function needsEscalation(messageBody) {
  const lower = (messageBody || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

export function getEscalationReason(messageBody) {
  const lower = (messageBody || '').toLowerCase();
  return ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
}

export async function escalateToMaddy(reason, phone, context) {
  const masked = maskPhone(phone);
  const params = [
    `⚠️ Escalation: ${reason}`,
    `Lead/Client: ${masked}`,
    `Context: ${context?.substring(0, 200) || 'N/A'}`,
  ];
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', params, true);
}

export async function escalateMissedCheckins(clientName, phone, missedCount) {
  await escalateToMaddy(
    `${missedCount} consecutive missed check-ins`,
    phone,
    `Client: ${clientName}`
  );
}

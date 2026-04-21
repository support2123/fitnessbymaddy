import { sendTemplate } from './whatsapp.js';

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'not eating', 'purging',
];

export function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

export async function escalateToMaddy(reason, context) {
  const alert = `🚨 ESCALATION: ${reason}\n\nPhone: ${context.phone}\nName: ${context.name || 'Unknown'}\nMessage: ${context.message || 'N/A'}\n\nPlease review and respond manually.`;

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, context.phone, context.message || '']);

  return { escalated: true, reason };
}

export async function escalateMissedCheckins(clientName, clientPhone, missedCount) {
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    `${clientName} missed ${missedCount} consecutive check-ins`,
    clientPhone,
    'Please follow up manually.',
  ]);
}

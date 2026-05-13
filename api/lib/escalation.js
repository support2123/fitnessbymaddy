import { sendTemplate } from './whatsapp.js';
import { maskPhone } from './whatsapp.js';

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'not eating', 'purging', 'anorexia', 'bulimia'
];

export function needsEscalation(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

export async function escalateToMaddy(reason, phone, messageBody) {
  const masked = maskPhone(phone);
  const alert = `🚨 ESCALATION\nReason: ${reason}\nLead: ${masked}\nMsg: ${(messageBody || '').slice(0, 200)}`;
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [alert], true);
  console.log(`Escalated: ${reason} for ${masked}`);
}

export async function escalateMissedCheckins(clientName, phone, missedCount) {
  if (missedCount >= 2) {
    await escalateToMaddy(
      `${missedCount} consecutive missed check-ins`,
      phone,
      `Client ${clientName} has missed ${missedCount} consecutive weekly check-ins.`
    );
  }
}

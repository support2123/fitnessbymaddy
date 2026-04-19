import { sendTemplate } from './whatsapp.js';
import { maskPhone } from './mask-phone.js';

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'didnt work',
  'side effect', 'side effects', 'vomit', 'faint', 'chest pain',
];

export function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

export function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe';
}

export async function escalateToMaddy(reason, phone, context) {
  const masked = maskPhone(phone);
  const params = [reason, masked, context.slice(0, 200)];
  await sendTemplate(MADDY_PHONE, 'escalation_alert', params, true);
  console.log(`Escalation sent to Maddy: ${reason} for ${masked}`);
}

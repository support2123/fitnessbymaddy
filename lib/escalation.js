import { sendWhatsApp } from './whatsapp.js';
import { maskPhone } from './market.js';

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating',
];

export function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

export function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

export async function escalateToMaddy(reason, phone, messageBody) {
  const masked = maskPhone(phone);
  const alert = `ESCALATION ALERT\nReason: ${reason}\nFrom: ${masked}\nMessage: "${messageBody?.slice(0, 200) || 'N/A'}"`;
  await sendWhatsApp(MADDY_PHONE, alert, null, true);
}

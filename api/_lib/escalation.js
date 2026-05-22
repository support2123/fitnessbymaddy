import { sendWhatsApp, maskPhone } from './whatsapp.js';

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex',
  'bulimi', 'not eating', 'vomit', 'faint'
];

export function checkEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

export async function escalateToMaddy(reason, phone, message) {
  console.log(`ESCALATION: ${reason} from ${maskPhone(phone)}`);

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
    reason,
    maskPhone(phone),
    (message || '').slice(0, 200)
  ]);

  return { escalated: true, reason };
}

export function checkOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

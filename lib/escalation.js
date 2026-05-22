import { notifyMaddy } from './whatsapp.js';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'not eating', 'vomiting'
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout'];

export function checkEscalation(messageText) {
  const lower = messageText.toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  return matched.length > 0 ? matched : null;
}

export function isOptOut(messageText) {
  const lower = messageText.toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower === kw || lower.includes(kw));
}

export async function handleEscalation(phone, messageText, triggers) {
  const masked = phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
  await notifyMaddy(
    `Escalation from ${masked}`,
    `Triggers: ${triggers.join(', ')}\nMessage: "${messageText.slice(0, 200)}"`
  );
}

export function detectProgram(messageText) {
  const lower = messageText.toLowerCase();

  if (/fat\s*loss|weight|shred|burn/i.test(lower)) {
    return { program: '6wk_gym', name: '6-Week Burn & Build', price: 97 };
  }
  if (/pcos|hormonal|hormone/i.test(lower)) {
    return { program: 'pcos', name: 'PCOS Warrior', price: 45 };
  }
  if (/40\+?|forty|menopause|joints|joint/i.test(lower)) {
    return { program: '40plus', name: '40+ Strong', price: 50 };
  }
  if (/custom|12\s*week|serious|flagship/i.test(lower)) {
    return { program: '12wk', name: '12-Week Flagship', price: 200 };
  }
  if (/trial|zoom|not sure|try/i.test(lower)) {
    return { program: 'zoom_trial', name: 'Zoom Trial Session', price: 20 };
  }
  if (/home|no\s*gym|bodyweight/i.test(lower)) {
    return { program: '6wk_home', name: '6-Week Home Program', price: 97 };
  }

  return null;
}

import { getSupabase } from './supabase.js';
import { notifyMaddy, maskPhone } from './whatsapp.js';

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'not working', 'scam'
];

export function needsEscalation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

export function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

export async function handleEscalation(phone, messageBody, reason) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody
  });

  await notifyMaddy(
    reason,
    `From ${maskPhone(phone)}: "${messageBody.slice(0, 200)}"`
  );
}

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'fat', 'lose weight'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', 'over 40'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'flagship', 'personali'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', '$20']
};

export function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return program;
    }
  }
  return null;
}

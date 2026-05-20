const { supabase } = require('./supabase');
const { notifyMaddy, maskPhone } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'not eating', 'fainting', 'chest pain', 'heart',
];

const MEDICAL_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'surgery', 'doctor', 'hospital', 'diabetes', 'thyroid',
];

function needsEscalation(message) {
  if (!message) return { escalate: false };
  const lower = message.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) {
      return { escalate: true, reason: `Message contains: "${kw}"` };
    }
  }
  return { escalate: false };
}

function hasMedicalFlag(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return MEDICAL_KEYWORDS.some(kw => lower.includes(kw));
}

async function createEscalation(phone, reason, context) {
  await supabase.from('escalations').insert({
    phone,
    reason,
    context,
  });
  await notifyMaddy(reason, `Phone: ${maskPhone(phone)} — ${context || ''}`);
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

module.exports = { needsEscalation, hasMedicalFlag, createEscalation, isOptOut };

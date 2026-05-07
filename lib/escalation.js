const { notifyMaddy } = require('./whatsapp');
const { maskPhone } = require('./market');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'bulimia', 'anorexia', 'purging', 'not eating',
];

const MEDICAL_KEYWORDS = [
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'doctor', 'hospital', 'medical condition', 'diabetic', 'diabetes',
  'thyroid', 'blood pressure', 'heart',
];

function checkEscalation(message) {
  const lower = message.toLowerCase();

  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) {
      return { escalate: true, reason: `Message contains: "${kw}"`, type: 'keyword' };
    }
  }

  return { escalate: false };
}

function checkMedical(message) {
  const lower = message.toLowerCase();
  for (const kw of MEDICAL_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

async function handleEscalation(phone, message, reason) {
  const masked = maskPhone(phone);
  await notifyMaddy(
    reason,
    `From ${masked}: "${message.substring(0, 150)}"`
  );
}

function isOptOut(message) {
  const lower = message.toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

module.exports = { checkEscalation, checkMedical, handleEscalation, isOptOut };

const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./utils');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'pain', 'dizziness', 'dizzy',
  'pregnant', 'pregnancy', 'medication', 'medical',
  'eating disorder', 'anorexia', 'bulimia', 'purging',
  'refund', 'lawyer', 'complaint', 'didn\'t work',
  'side effect', 'side effects',
];

const MEDICAL_KEYWORDS = [
  'injury', 'injured', 'pain', 'dizziness', 'dizzy',
  'pregnant', 'pregnancy', 'medication', 'medical',
  'surgery', 'doctor', 'hospital',
];

function needsEscalation(text) {
  if (!text) return { escalate: false };
  const lower = text.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { escalate: true, reason: keyword };
    }
  }
  return { escalate: false };
}

function hasMedicalFlag(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return MEDICAL_KEYWORDS.some(k => lower.includes(k));
}

async function notifyMaddy(leadPhone, reason, messageBody) {
  console.log(`ESCALATION: ${maskPhone(leadPhone)} — ${reason}`);
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    maskPhone(leadPhone),
    (messageBody || '').slice(0, 200),
  ]);
}

module.exports = { needsEscalation, hasMedicalFlag, notifyMaddy };

const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'not working', 'scam', 'fraud'
];

const MEDICAL_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'surgery', 'doctor',
  'eating disorder', 'anorexia', 'bulimia'
];

function checkEscalation(message) {
  if (!message) return { needed: false };
  const lower = message.toLowerCase();

  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return {
        needed: true,
        reason: `Message contains "${keyword}"`,
        isMedical: MEDICAL_KEYWORDS.includes(keyword)
      };
    }
  }
  return { needed: false };
}

function checkOptOut(message) {
  if (!message) return false;
  const lower = message.toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

async function notifyMaddy(leadPhone, reason, context) {
  console.log(`ESCALATION: ${maskPhone(leadPhone)} — ${reason}`);

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    maskPhone(leadPhone),
    reason,
    context || 'No additional context'
  ]);
}

module.exports = { checkEscalation, checkOptOut, notifyMaddy };

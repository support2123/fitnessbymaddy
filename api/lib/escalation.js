const { sendWhatsApp, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'doctor', 'pregnant', 'pregnancy',
  'medication', 'medicine', 'pain', 'dizziness', 'dizzy', 'faint',
  'eating disorder', 'anorexia', 'bulimia', 'purging', 'binge',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'not working', 'scam', 'fraud',
];

function needsEscalation(message) {
  if (!message) return { escalate: false };
  const lower = message.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) {
      return { escalate: true, keyword: kw };
    }
  }
  return { escalate: false };
}

async function escalateToMaddy(phone, reason, context) {
  const masked = maskPhone(phone);
  const body = [
    `ESCALATION from ${masked}`,
    `Reason: ${reason}`,
    `Context: ${context.substring(0, 200)}`,
  ];
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', body);
  console.log(`Escalated: ${masked} — ${reason}`);
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };

const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'purge', 'vomit'
];

function needsEscalation(message) {
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, phone, context) {
  const masked = maskPhone(phone);
  const params = [
    reason,
    masked,
    context.substring(0, 200)
  ];

  await sendTemplate(MADDY_PHONE, 'escalation_alert', params);
  console.log(`ESCALATION: ${reason} from ${masked}`);
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };

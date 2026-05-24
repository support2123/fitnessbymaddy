const { notifyMaddy, maskPhone } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating'
];

function checkEscalation(message, phone) {
  const lower = (message || '').toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      notifyMaddy(
        `Escalation trigger: "${keyword}"`,
        `From ${maskPhone(phone)}: ${message.slice(0, 100)}`
      );
      return true;
    }
  }
  return false;
}

module.exports = { checkEscalation, ESCALATION_KEYWORDS };

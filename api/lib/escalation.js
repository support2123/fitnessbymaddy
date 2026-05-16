const { notifyMaddy, maskPhone } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'faint', 'chest pain', 'heart'
];

function checkEscalation(message, phone) {
  const lower = message.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      notifyMaddy(
        `Keyword "${keyword}" detected`,
        `From: ${maskPhone(phone)}\nMessage: ${message.slice(0, 200)}`
      );
      return true;
    }
  }
  return false;
}

module.exports = { checkEscalation, ESCALATION_KEYWORDS };

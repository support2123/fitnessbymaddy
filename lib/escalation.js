const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'injured', 'medical', 'pregnancy', 'pregnant',
  'medication', 'pain', 'dizziness', 'dizzy', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'faint', 'fainting',
  'chest pain', 'heart', 'surgery', 'hospital'
];

function checkEscalation(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

function classifyEscalationReason(keyword) {
  const medical = ['injury', 'injured', 'medical', 'pregnancy', 'pregnant',
    'medication', 'pain', 'dizziness', 'dizzy', 'faint', 'fainting',
    'chest pain', 'heart', 'surgery', 'hospital'];
  const eating = ['eating disorder', 'anorexia', 'bulimia', 'purging'];
  const complaint = ['refund', 'lawyer', 'complaint', "didn't work", 'side effect'];

  if (medical.includes(keyword)) return 'medical_concern';
  if (eating.includes(keyword)) return 'disordered_eating_signal';
  if (complaint.includes(keyword)) return 'complaint_or_refund';
  return 'unknown';
}

module.exports = { checkEscalation, classifyEscalationReason, ESCALATION_KEYWORDS };

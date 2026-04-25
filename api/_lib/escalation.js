const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'condition', 'pregnancy', 'pregnant',
  'medication', 'medicine', 'pain', 'dizziness', 'dizzy',
  'eating disorder', 'anorexia', 'bulimia', 'purging',
  'refund', 'lawyer', 'legal', 'complaint',
  "didn't work", 'side effect', 'side effects', 'scam', 'fraud'
];

function checkEscalation(message) {
  const lower = message.toLowerCase();
  const triggers = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  return { shouldEscalate: triggers.length > 0, triggers };
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

async function notifyMaddy(supabase, sendTemplate, person, reason) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  await sendTemplate(maddyPhone, 'escalation_alert', [
    person.name || 'Unknown',
    maskPhone(person.phone),
    reason
  ]);
}

module.exports = { checkEscalation, notifyMaddy, maskPhone };

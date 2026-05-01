const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'not eating', 'fainting'
];

function needsEscalation(messageText) {
  const lower = (messageText || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const msg = `ESCALATION: ${reason}\nPhone: ${context.phone}\nName: ${context.name || 'Unknown'}\nMessage: ${(context.message || '').slice(0, 200)}`;

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    context.phone || 'N/A',
    (context.message || '').slice(0, 100)
  ]);

  return { escalated: true, reason };
}

function classifyProgram(text) {
  const lower = (text || '').toLowerCase();

  if (/fat\s*loss|weight\s*loss|shred|lean|cut/i.test(lower)) {
    return { program: '6wk_gym', name: '6-Week Burn & Build', price: 97 };
  }
  if (/pcos|hormonal|hormone|period|irregular/i.test(lower)) {
    return { program: 'pcos', name: 'PCOS Warrior', price: 45 };
  }
  if (/40\+?|forty|menopause|joint|joints|older/i.test(lower)) {
    return { program: '40plus', name: '40+ Strong', price: 50 };
  }
  if (/custom|12\s*week|serious|flagship|transform/i.test(lower)) {
    return { program: '12wk', name: '12-Week Flagship', price: 200 };
  }
  if (/trial|zoom|not\s*sure|try|test/i.test(lower)) {
    return { program: 'zoom_trial', name: 'Zoom Trial', price: 20 };
  }
  if (/home|no\s*gym|bodyweight|at\s*home/i.test(lower)) {
    return { program: '6wk_home', name: '6-Week Home', price: 79 };
  }
  return null;
}

module.exports = { needsEscalation, escalateToMaddy, classifyProgram, ESCALATION_KEYWORDS };

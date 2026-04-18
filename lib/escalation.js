const supabase = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./market');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulimi',
  'not eating', "can't eat", 'throwing up', 'vomit'
];

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

function checkEscalation(message) {
  const lower = (message || '').toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

async function escalateToMaddy(reason, phone, context) {
  const masked = maskPhone(phone);

  await supabase.from('escalations').insert({
    phone,
    reason,
    context: (context || '').substring(0, 500)
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    masked,
    (context || '').substring(0, 200)
  ], 'Maddy');
}

module.exports = { checkEscalation, escalateToMaddy, ESCALATION_KEYWORDS };

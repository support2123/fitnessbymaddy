const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'surgery', 'doctor', 'hospital'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function notifyMaddy(supabase, reason, context) {
  const { sendTemplate } = require('./whatsapp');
  const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

  await sendTemplate(supabase, MADDY_PHONE, 'escalation_alert', {
    reason,
    context: typeof context === 'string' ? context : JSON.stringify(context)
  });
}

module.exports = { needsEscalation, notifyMaddy, ESCALATION_KEYWORDS };

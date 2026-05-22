const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'vomit', 'faint', 'chest pain', 'heart', 'surgery'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function notifyMaddy(reason, context, sendWhatsApp) {
  const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';
  const msg = `ESCALATION ALERT\n\nReason: ${reason}\n\nContext: ${JSON.stringify(context, null, 2).slice(0, 800)}`;

  await sendWhatsApp(MADDY_PHONE, msg);
}

module.exports = { needsEscalation, notifyMaddy, ESCALATION_KEYWORDS };

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating',
];

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

export function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

export function buildEscalationAlert(lead, message) {
  const masked = lead.phone.slice(0, 4) + 'XXX...' + lead.phone.slice(-3);
  return {
    phone: MADDY_PHONE,
    text: [
      `🚨 ESCALATION ALERT`,
      `Lead: ${lead.name || 'Unknown'} (${masked})`,
      `Message: "${message.slice(0, 200)}"`,
      `Action needed — check admin dashboard.`,
    ].join('\n'),
  };
}

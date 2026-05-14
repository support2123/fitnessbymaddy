const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'vomit', 'faint', 'chest pain', 'heart', 'surgery'
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function notifyMaddy(supabase, sendWhatsApp, reason, context) {
  const MADDY_PHONE = '+917082478374';
  const body = `ESCALATION: ${reason}\n\nContext: ${context}`;

  await sendWhatsApp(MADDY_PHONE, body);

  await supabase.from('messages').insert({
    phone: MADDY_PHONE,
    direction: 'out',
    body,
    template_name: 'escalation_alert',
  });
}

module.exports = { needsEscalation, notifyMaddy, ESCALATION_KEYWORDS };

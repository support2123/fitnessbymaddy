const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'bulimia',
  'anorexia', 'not eating', 'faint', 'hospital'
];

function needsEscalation(text) {
  if (!text) return { escalate: false };
  const lower = text.toLowerCase();
  const matched = ESCALATION_KEYWORDS.find(kw => lower.includes(kw));
  if (matched) return { escalate: true, reason: matched };
  return { escalate: false };
}

async function notifyMaddy(supabase, sendWhatsApp, reason, context) {
  const adminPhone = process.env.MADDY_PHONE || '917082478374';
  const body = `ESCALATION: ${reason}\n\nContext: ${context}`;
  await sendWhatsApp(adminPhone, body);
  await supabase.from('messages').insert({
    phone: adminPhone,
    direction: 'out',
    body,
    template_name: 'escalation_alert',
    status: 'sent'
  });
}

module.exports = { needsEscalation, notifyMaddy, ESCALATION_KEYWORDS };

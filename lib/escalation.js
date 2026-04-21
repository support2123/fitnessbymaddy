const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex',
  'bulimi', 'not eating', 'faint', 'chest pain',
];

function needsEscalation(messageText) {
  const lower = messageText.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

async function notifyMaddy(reason, context, { whatsapp, supabase }) {
  const msg = `🚨 ESCALATION\n${reason}\nLead/Client: ${maskPhone(context.phone)}\n${context.detail || ''}`;
  await whatsapp.sendText(process.env.MADDY_PHONE, msg, { supabase });
}

module.exports = { needsEscalation, notifyMaddy, maskPhone };

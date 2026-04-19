const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'chest pain', 'faint', 'vomiting', 'surgery', 'doctor said'
];

function checkEscalation(message) {
  const lower = message.toLowerCase();
  const triggers = ESCALATION_KEYWORDS.filter(function (kw) {
    return lower.includes(kw);
  });
  return triggers.length > 0 ? triggers : null;
}

async function notifyMaddy(supabase, whatsapp, details) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';

  await whatsapp.sendTemplate(maddyPhone, 'escalation_alert', [
    details.type,
    details.summary.slice(0, 200),
    details.phone_masked
  ]);

  await supabase.from('messages').insert({
    phone: maddyPhone,
    direction: 'out',
    body: 'ESCALATION [' + details.type + ']: ' + details.summary,
    template_name: 'escalation_alert',
    status: 'sent'
  });
}

module.exports = { checkEscalation, notifyMaddy };

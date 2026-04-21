const { supabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'purge', 'starving'
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function createEscalation(phone, reason, messageBody) {
  await supabase.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody
  });

  await sendTemplate(process.env.MADDY_PHONE, 'escalation_alert', [
    reason,
    phone.slice(-4)
  ]);
}

module.exports = { needsEscalation, createEscalation, ESCALATION_KEYWORDS };

const { sendTemplate } = require('./whatsapp');
const { getSupabase } = require('./supabase');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating'
];

function needsEscalation(messageText) {
  const lower = (messageText || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const db = getSupabase();

  await db.from('messages').insert({
    phone: MADDY_PHONE,
    direction: 'out',
    body: `ESCALATION: ${reason} | ${JSON.stringify(context)}`,
    template_name: 'escalation_alert',
    sent_at: new Date().toISOString(),
    status: 'pending'
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [
      reason,
      context.phone || 'Unknown',
      context.detail || ''
    ]
  });
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };

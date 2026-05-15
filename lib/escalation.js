const { sendTemplate } = require('./whatsapp');
const { getSupabase } = require('./supabase');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'bulimia', 'anorexia', 'purge', 'vomit'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function escalateToMaddy(reason, context) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone: MADDY_PHONE,
    direction: 'out',
    body: `ESCALATION: ${reason} — ${JSON.stringify(context)}`,
    template_name: 'escalation_alert',
    sent_at: new Date().toISOString(),
    status: 'pending'
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', {
    isClient: true,
    templateParams: [reason, context.phone || 'unknown']
  });
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy, MADDY_PHONE };

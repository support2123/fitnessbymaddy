const { supabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating',
];

function needsEscalation(text) {
  const lower = (text || '').toLowerCase();
  return ESCALATION_KEYWORDS.find(kw => lower.includes(kw)) || null;
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function escalate(phone, reason, sourceMessage) {
  await supabase().from('escalations').insert({
    phone,
    reason,
    source_message: sourceMessage,
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    maskPhone(phone),
    reason,
    (sourceMessage || '').slice(0, 200),
  ]);
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

module.exports = { needsEscalation, isOptOut, escalate, maskPhone };

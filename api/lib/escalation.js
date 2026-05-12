const { sendTemplate } = require('./whatsapp');
const { supabase } = require('./supabase');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulim',
  'vomit', 'faint', 'chest pain', 'heart'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, details) {
  const msg = `ESCALATION: ${reason}\n${details}`;

  await supabase.from('messages').insert({
    phone: MADDY_PHONE,
    direction: 'out',
    body: msg,
    template_name: 'escalation_alert',
    status: 'pending'
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', {
    templateParams: [reason, details.slice(0, 200)]
  });
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

module.exports = { needsEscalation, escalateToMaddy, isOptOut, ESCALATION_KEYWORDS };

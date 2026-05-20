const { supabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./mask');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'faint', 'chest pain', 'heart'
];

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

function needsEscalation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

async function createEscalation(phone, reason, message) {
  await supabase.from('escalations').insert({
    phone,
    reason,
    message
  });

  await sendWhatsApp(MADDY_PHONE, null, {
    text: `ESCALATION: Lead ${maskPhone(phone)} mentioned "${reason}". Message: "${(message || '').slice(0, 200)}". Please review.`
  });
}

module.exports = { needsEscalation, createEscalation, ESCALATION_KEYWORDS };

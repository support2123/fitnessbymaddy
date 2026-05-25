const { supabase } = require('./supabase');
const { sendWhatsApp, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'anorexia', 'bulimia',
  'heart', 'surgery', 'hospital', 'doctor said'
];

function needsEscalation(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function getEscalationReason(messageBody) {
  const lower = messageBody.toLowerCase();
  if (['refund', 'lawyer', 'complaint'].some(k => lower.includes(k))) return 'refund_or_complaint';
  if (['injury', 'pain', 'dizzy', 'dizziness', 'surgery', 'hospital'].some(k => lower.includes(k))) return 'medical_concern';
  if (['pregnant', 'pregnancy', 'medication', 'doctor said'].some(k => lower.includes(k))) return 'medical_condition';
  if (['eating disorder', 'anorexia', 'bulimia'].some(k => lower.includes(k))) return 'disordered_eating';
  if (["didn't work", 'side effect'].some(k => lower.includes(k))) return 'negative_feedback';
  return 'general';
}

async function escalateToMaddy(phone, reason, messageBody, clientId, leadId) {
  await supabase.from('escalations').insert({
    phone,
    client_id: clientId || null,
    lead_id: leadId || null,
    reason,
    message_body: messageBody
  });

  const masked = maskPhone(phone);
  const alert = `⚠️ ESCALATION [${reason}]\nFrom: ${masked}\nMessage: "${messageBody?.slice(0, 200) || 'N/A'}"\n\nPlease review in the admin dashboard.`;

  await sendWhatsApp(MADDY_PHONE, alert, null);
}

module.exports = { needsEscalation, getEscalationReason, escalateToMaddy };

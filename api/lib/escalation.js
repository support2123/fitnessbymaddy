const { supabase } = require('./supabase');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'faint', 'chest pain', 'heart'
];

const MEDICAL_KEYWORDS = [
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'faint', 'chest pain', 'heart', 'diabetes',
  'thyroid', 'blood pressure'
];

function needsEscalation(message) {
  if (!message) return { escalate: false };
  const lower = message.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) {
      return { escalate: true, reason: `Message contains "${kw}"` };
    }
  }
  return { escalate: false };
}

function hasMedicalFlag(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return MEDICAL_KEYWORDS.some(kw => lower.includes(kw));
}

async function createEscalation(phone, reason, messageBody, clientId) {
  const { error } = await supabase.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody,
    client_id: clientId || null
  });
  if (error) console.error('Escalation insert error:', error.message);
}

async function notifyMaddy(phone, reason, sendWhatsApp) {
  const maskPhone = require('./market').maskPhone;
  const masked = maskPhone(phone);
  const text = `ESCALATION ALERT\nLead: ${masked}\nReason: ${reason}\nPlease check the admin dashboard.`;
  await sendWhatsApp(process.env.MADDY_PHONE || '+917082478374', text);
}

module.exports = { needsEscalation, hasMedicalFlag, createEscalation, notifyMaddy };

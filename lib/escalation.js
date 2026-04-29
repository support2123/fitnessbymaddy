const { getSupabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./utils');

const MADDY_PHONE = '+917082478374';

async function escalateToMaddy(phone, reason, messageBody) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody,
  });

  const masked = maskPhone(phone);
  const alertParams = [
    reason,
    masked,
    (messageBody || '').slice(0, 200),
  ];

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', alertParams);

  console.log(`[ESCALATION] ${reason} from ${masked}`);
}

const ESCALATION_REASONS = {
  injury: 'Lead mentioned injury or medical condition',
  medical: 'Medical condition or medication mentioned',
  pain: 'Client reported pain or dizziness',
  eating_disorder: 'Possible disordered eating signals',
  refund: 'Refund request received',
  payment_fail: 'Payment failure for active client',
  missed_checkins: '2 consecutive missed check-ins',
  complaint: 'Complaint or legal mention',
};

function detectEscalationReason(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/refund/.test(lower)) return 'refund';
  if (/lawyer|legal|complaint|"didn't work"|side effect/.test(lower)) return 'complaint';
  if (/pregnan/.test(lower)) return 'medical';
  if (/injury|injur/.test(lower)) return 'injury';
  if (/medication|medicine/.test(lower)) return 'medical';
  if (/pain|dizz/.test(lower)) return 'pain';
  if (/anorex|bulimi|eating disorder|starv/.test(lower)) return 'eating_disorder';
  return null;
}

module.exports = {
  escalateToMaddy,
  ESCALATION_REASONS,
  detectEscalationReason,
};

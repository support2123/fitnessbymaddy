const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'faint', 'heart', 'surgery', 'hospital'
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout'];

function needsEscalation(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower === kw || lower.includes(kw));
}

async function createEscalation(phone, reason, messageBody, clientId) {
  const { error } = await supabase.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody
  });
  if (error) {
    console.error(`Escalation insert failed for ${maskPhone(phone)}:`, error.message);
  }
}

async function notifyMaddy(reason, phone, messageBody) {
  const masked = maskPhone(phone);
  console.log(`[ESCALATION] ${reason} from ${masked}: ${messageBody?.slice(0, 100)}`);

  try {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'FitnessByMaddy Bot <support@fitnessbymaddy.com>',
      to: 'support@fitnessbymaddy.com',
      subject: `[ESCALATION] ${reason}`,
      text: `Phone: ${phone}\nReason: ${reason}\nMessage: ${messageBody || 'N/A'}\n\nPlease review in the admin dashboard.`
    });
  } catch (e) {
    console.error('Email notification failed:', e.message);
  }
}

module.exports = { needsEscalation, isOptOut, createEscalation, notifyMaddy, ESCALATION_KEYWORDS };

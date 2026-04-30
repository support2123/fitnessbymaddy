const { supabase } = require('./supabase');
const { sendWhatsAppToClient } = require('./whatsapp');
const { ESCALATION_KEYWORDS, MADDY_PHONE } = require('./constants');
const { maskPhone } = require('./market');

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

async function escalateToMaddy(phone, reason, messageBody) {
  await supabase.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody
  });

  const alert = `ESCALATION from ${maskPhone(phone)}\nReason: ${reason}\nMessage: ${messageBody || 'N/A'}`;
  await sendWhatsAppToClient(MADDY_PHONE, alert, null);

  console.log(`Escalated: ${maskPhone(phone)} - ${reason}`);
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy };

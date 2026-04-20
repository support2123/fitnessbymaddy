const { ESCALATION_KEYWORDS, MADDY_PHONE } = require('./constants');
const { sendText, maskPhone } = require('./whatsapp');

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(phone, reason, context) {
  const msg = `🚨 ESCALATION NEEDED\n\nLead/Client: ${maskPhone(phone)}\nReason: ${reason}\nMessage: "${context?.substring(0, 200)}"\n\nPlease review and respond manually.`;
  await sendText(MADDY_PHONE, msg, true);
}

module.exports = { needsEscalation, escalateToMaddy };

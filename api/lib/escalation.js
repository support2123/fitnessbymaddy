import { ESCALATION_KEYWORDS, MADDY_PHONE } from './constants.js';
import { maskPhone } from './market.js';

export function needsEscalation(message) {
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

export function getEscalationReason(message) {
  const lower = message.toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  return matched.join(', ');
}

export async function notifyMaddy(phone, reason, context, sendWhatsApp) {
  const masked = maskPhone(phone);
  const alertMsg = `🚨 ESCALATION ALERT\nLead: ${masked}\nReason: ${reason}\nMessage: "${context.slice(0, 200)}"`;

  await sendWhatsApp(MADDY_PHONE, alertMsg);
}

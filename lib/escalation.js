const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./helpers');

const MADDY_PHONE = '+917082478374';

async function escalateToMaddy(reason, details) {
  const msg = `[ESCALATION] ${reason}\n${details}`;
  console.warn(`[Escalation] ${reason} — ${details}`);
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, details]);
  return { escalated: true, reason };
}

async function notifyMaddy(subject, details) {
  console.log(`[Notify] ${subject} — ${details}`);
  await sendTemplate(MADDY_PHONE, 'admin_notify', [subject, details]);
}

module.exports = { escalateToMaddy, notifyMaddy, MADDY_PHONE };
